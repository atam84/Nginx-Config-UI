package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/xenos/nginx-config-ui/internal/api"
	"github.com/xenos/nginx-config-ui/internal/auth"
	"github.com/xenos/nginx-config-ui/internal/docs"
	"github.com/xenos/nginx-config-ui/internal/model"
	"github.com/xenos/nginx-config-ui/internal/parser"
	"github.com/xenos/nginx-config-ui/internal/paths"
	"github.com/xenos/nginx-config-ui/internal/security"
	"github.com/xenos/nginx-config-ui/internal/serializer"
	"github.com/xenos/nginx-config-ui/internal/system"
)

var (
	lastReloadMu   sync.RWMutex
	lastReloadAt   time.Time
	lastReloadErr  string
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8081" // Default to 8081 to avoid conflict with common services on 8080
	}
	sysCfg := system.DefaultConfig()
	r := gin.Default()

	// Serve frontend static files (if frontend/dist exists)
	if dist := filepath.Join("frontend", "dist"); exists(dist) {
		r.Static("/assets", filepath.Join(dist, "assets"))
		r.NoRoute(func(c *gin.Context) {
			if strings.HasPrefix(c.Request.URL.Path, "/api") || strings.HasPrefix(c.Request.URL.Path, "/openapi") || c.Request.URL.Path == "/docs" || c.Request.URL.Path == "/health" {
				c.Status(http.StatusNotFound)
				return
			}
			c.File(filepath.Join(dist, "index.html"))
		})
	}

	// Auth
	authCfg := auth.FromEnv()
	r.Use(auth.Middleware(authCfg))
	r.POST("/api/auth/login", auth.LoginHandler(authCfg))

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// Example: return a sample config structure (placeholder for real API)
	r.GET("/api/examples/config", func(c *gin.Context) {
		cfg := model.ConfigFile{
			FilePath: "/etc/nginx/conf.d/default.conf",
			Status:   "enabled",
			Directives: []model.Node{
				{
					ID:         "uuid-1",
					Type:       model.NodeTypeDirective,
					Name:       "worker_processes",
					Args:       []string{"auto"},
					LineNumber: 1,
					Enabled:    true,
				},
				{
					ID:         "uuid-2",
					Type:       model.NodeTypeBlock,
					Name:       "http",
					Args:       nil,
					Enabled:    true,
					Directives: []model.Node{},
				},
			},
		}
		cfg.EnsureConfigFileIDs()
		c.JSON(http.StatusOK, cfg)
	})

	// Parse Nginx config from request body
	r.POST("/api/config/parse", func(c *gin.Context) {
		type parseRequest struct {
			Content  string `json:"content"`
			FilePath string `json:"file_path"`
		}
		body, _ := c.GetRawData()
		content := string(body)
		filePath := c.GetHeader("X-File-Path")

		var req parseRequest
		if json.Unmarshal(body, &req) == nil && req.Content != "" {
			content = req.Content
			if req.FilePath != "" {
				filePath = req.FilePath
			}
		}
		if content == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "missing content"})
			return
		}
		if filePath == "" {
			filePath = "/etc/nginx/nginx.conf"
		}
		cfg, err := parser.ParseFromString(content, filePath)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, cfg)
	})

	// Serialize ConfigFile JSON to Nginx config text
	r.POST("/api/config/serialize", func(c *gin.Context) {
		var cfg model.ConfigFile
		if err := c.ShouldBindJSON(&cfg); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		text := serializer.Serialize(&cfg)
		c.Header("Content-Type", "text/plain; charset=utf-8")
		c.String(http.StatusOK, text)
	})

	// Validate config content (pre-save: write to temp, nginx -t -c)
	r.POST("/api/config/validate", func(c *gin.Context) {
		body, _ := io.ReadAll(c.Request.Body)
		content := string(body)
		if content == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "missing content"})
			return
		}
		result, _ := system.ValidateConfigContent(sysCfg, content)
		status := http.StatusOK
		if !result.Success {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{
			"success": result.Success,
			"output":  result.Output,
		})
	})

	// Config root and OpenAPI docs
	configRoot := os.Getenv("NGINX_CONFIG_ROOT")
	if configRoot == "" {
		configRoot = "/etc/nginx"
	}
	configRootMu := sync.RWMutex{}
	getConfigRoot := func() string {
		configRootMu.RLock()
		defer configRootMu.RUnlock()
		return configRoot
	}
	setConfigRoot := func(v string) {
		configRootMu.Lock()
		configRoot = v
		configRootMu.Unlock()
	}
	r.GET("/openapi.json", docs.ServeOpenAPIJSON())
	r.GET("/docs", docs.ServeSwaggerUI())

	r.GET("/api/config-root", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"config_root": getConfigRoot()})
	})
	r.POST("/api/config-root", func(c *gin.Context) {
		var req struct {
			ConfigRoot string `json:"config_root"`
		}
		if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.ConfigRoot) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "config_root required"})
			return
		}
		root := filepath.Clean(strings.TrimSpace(req.ConfigRoot))
		info, err := os.Stat(root)
		if err != nil || !info.IsDir() {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid config_root directory"})
			return
		}
		setConfigRoot(root)
		c.JSON(http.StatusOK, gin.H{"success": true, "config_root": root})
	})

	// List config files
	r.GET("/api/config", func(c *gin.Context) {
		root := getConfigRoot()
		fileInfos, err := api.ListConfigFiles(root)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"files": fileInfos})
	})

	// Create config file
	r.POST("/api/config/create", func(c *gin.Context) {
		var req struct {
			Filename   string `json:"filename"`
			TargetDir  string `json:"target_dir"` // "conf.d" (default) or "sites-available"
		}
		c.ShouldBindJSON(&req)
		root := getConfigRoot()
		path, err := api.CreateConfig(root, req.Filename, req.TargetDir)
		if err != nil {
			status := http.StatusBadRequest
			if err == api.ErrFileExists {
				c.JSON(status, gin.H{"error": err.Error()})
				return
			}
			c.JSON(status, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "path": path})
	})

	// Enable/disable site (sites-available only)
	r.POST("/api/config/enable", func(c *gin.Context) {
		var req struct {
			Path string `json:"path"`
		}
		if err := c.ShouldBindJSON(&req); err != nil || req.Path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "missing path"})
			return
		}
		if err := api.EnableConfig(getConfigRoot(), req.Path); err != nil {
			if err == api.ErrNotSitesAvailable {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true})
	})
	r.POST("/api/config/disable", func(c *gin.Context) {
		var req struct {
			Path string `json:"path"`
		}
		if err := c.ShouldBindJSON(&req); err != nil || req.Path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "missing path"})
			return
		}
		if err := api.DisableConfig(getConfigRoot(), req.Path); err != nil {
			if err == api.ErrNotSitesAvailable {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true})
	})

	// Upstreams list
	r.GET("/api/upstreams", func(c *gin.Context) {
		upstreams, err := api.ListUpstreamsFromConfigRoot(getConfigRoot())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, upstreams)
	})

	// Create server block
	r.POST("/api/server", func(c *gin.Context) {
		var req api.CreateServerRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if req.FilePath == "" {
			req.FilePath = "conf.d/default.conf"
		}
		root := getConfigRoot()
		safePath := paths.SanitizeConfigPath(root, req.FilePath)
		if safePath == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid file_path"})
			return
		}
		cfg, err := parser.ParseFromFile(safePath)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot load config: " + err.Error()})
			return
		}
		server := api.CreateServerBlock(&req)
		api.AddServerToConfig(cfg, server)
		if err := api.SaveConfig(sysCfg, root, req.FilePath, cfg); err != nil {
			var ve *api.ValidationError
			if errors.As(err, &ve) {
				c.JSON(http.StatusBadRequest, gin.H{"error": ve.Error(), "output": ve.Output})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true})
	})

	// Add location block
	r.POST("/api/location", func(c *gin.Context) {
		var req api.AddLocationRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if req.FilePath == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "file_path required"})
			return
		}
		root := getConfigRoot()
		safePath := paths.SanitizeConfigPath(root, req.FilePath)
		if safePath == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid file_path"})
			return
		}
		cfg, err := parser.ParseFromFile(safePath)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		loc := api.CreateLocationBlock(&req)
		if !api.AddLocationToServer(cfg, req.ServerIndex, loc) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "server not found"})
			return
		}
		if err := api.SaveConfig(sysCfg, root, req.FilePath, cfg); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true})
	})

	// Get config file
	r.GET("/api/config/*path", func(c *gin.Context) {
		path := strings.TrimPrefix(c.Param("path"), "/")
		if path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "missing path"})
			return
		}
		root := getConfigRoot()
		safePath := paths.SanitizeConfigPath(root, path)
		if safePath == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid path"})
			return
		}
		cfg, err := parser.ParseFromFile(safePath)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		cfg.FilePath = path
		cfg.Status = api.FileStatus(root, path)
		c.JSON(http.StatusOK, cfg)
	})

	// Save config file
	r.PUT("/api/config/*path", func(c *gin.Context) {
		path := strings.TrimPrefix(c.Param("path"), "/")
		if path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "missing path"})
			return
		}
		root := getConfigRoot()
		safePath := paths.SanitizeConfigPath(root, path)
		if safePath == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid path"})
			return
		}
		var cfg model.ConfigFile
		if err := c.ShouldBindJSON(&cfg); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := api.SaveConfig(sysCfg, root, path, &cfg); err != nil {
			var ve *api.ValidationError
			if errors.As(err, &ve) {
				c.JSON(http.StatusBadRequest, gin.H{"error": ve.Error(), "output": ve.Output})
				return
			}
			var se *security.ConfigValidationError
			if errors.As(err, &se) {
				c.JSON(http.StatusBadRequest, gin.H{"error": se.Error()})
				return
			}
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "Saved"})
	})

	// Delete config file
	r.DELETE("/api/config/*path", func(c *gin.Context) {
		path := strings.TrimPrefix(c.Param("path"), "/")
		if path == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "missing path"})
			return
		}
		if err := api.DeleteConfig(getConfigRoot(), path); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true})
	})

	// System operations
	r.POST("/api/system/test", func(c *gin.Context) {
		result := system.TestConfig(sysCfg)
		c.JSON(http.StatusOK, gin.H{
			"success": result.Success,
			"output":  result.Output,
		})
	})
	r.POST("/api/system/reload", func(c *gin.Context) {
		result := system.Reload(sysCfg)
		lastReloadMu.Lock()
		lastReloadAt = time.Now()
		if result.Success {
			lastReloadErr = ""
		} else {
			lastReloadErr = result.Message
		}
		lastReloadMu.Unlock()
		status := http.StatusOK
		if !result.Success {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{
			"success": result.Success,
			"message": result.Message,
		})
	})
	r.GET("/api/system/status", func(c *gin.Context) {
		result := system.Status(sysCfg)
		lastReloadMu.RLock()
		at := lastReloadAt
		errMsg := lastReloadErr
		lastReloadMu.RUnlock()
		resp := gin.H{
			"active":         result.Active,
			"status":         result.Output,
			"last_reload_at": nil,
			"last_error":     errMsg,
		}
		if !at.IsZero() {
			resp["last_reload_at"] = at.Format(time.RFC3339)
		}
		c.JSON(http.StatusOK, resp)
	})
	r.GET("/api/stats", func(c *gin.Context) {
		stats, err := api.GetStats(getConfigRoot())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, stats)
	})
	r.GET("/api/backup", func(c *gin.Context) {
		path, err := system.Backup(sysCfg)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.Header("Content-Disposition", "attachment; filename="+filepath.Base(path))
		c.File(path)
	})
	r.POST("/api/restore", func(c *gin.Context) {
		file, err := c.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "missing file upload"})
			return
		}
		tmp, err := os.CreateTemp("", "nginx-restore-*.tar.gz")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defer os.Remove(tmp.Name())
		defer tmp.Close()
		src, err := file.Open()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defer src.Close()
		if _, err := io.Copy(tmp, src); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		tmp.Close()
		result := system.Restore(sysCfg, tmp.Name())
		status := http.StatusOK
		if !result.Success {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{
			"success": result.Success,
			"message": result.Message,
		})
	})

	addr := fmt.Sprintf(":%s", port)
	if err := r.Run(addr); err != nil {
		log.Fatalf("server failed: %v", err)
	}
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
