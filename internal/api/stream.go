package api

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/xenos/nginx-config-ui/internal/model"
	"github.com/xenos/nginx-config-ui/internal/parser"
	"github.com/xenos/nginx-config-ui/internal/paths"
	"github.com/xenos/nginx-config-ui/internal/system"
)

// CreateStreamServerRequest is the payload for creating a stream server block.
type CreateStreamServerRequest struct {
	FilePath            string `json:"file_path"`
	Listen              string `json:"listen"`
	UDP                 bool   `json:"udp"`
	SSL                 bool   `json:"ssl"`
	ProxyPass           string `json:"proxy_pass"`
	ProxyTimeout        string `json:"proxy_timeout"`
	ProxyConnectTimeout string `json:"proxy_connect_timeout"`
	ProxyBufferSize     string `json:"proxy_buffer_size"`
	SSLPreread          bool   `json:"ssl_preread"`
}

// CreateStreamUpstreamRequest is the payload for creating a stream upstream block.
type CreateStreamUpstreamRequest struct {
	FilePath string   `json:"file_path"`
	Name     string   `json:"name"`
	Servers  []string `json:"servers"`
}

// AddStreamServerToConfig finds or creates the stream {} block and appends the server.
func AddStreamServerToConfig(cfg *model.ConfigFile, server model.Node) {
	for i := range cfg.Directives {
		if cfg.Directives[i].Name == "stream" && cfg.Directives[i].Type == model.NodeTypeBlock {
			cfg.Directives[i].Directives = append(cfg.Directives[i].Directives, server)
			cfg.EnsureConfigFileIDs()
			return
		}
	}
	// No stream block — create one with the server
	cfg.Directives = append(cfg.Directives, model.Node{
		Type:       model.NodeTypeBlock,
		Name:       "stream",
		Args:       []string{},
		Enabled:    true,
		Directives: []model.Node{server},
	})
	cfg.EnsureConfigFileIDs()
}

// AddStreamUpstreamToConfig finds or creates the stream {} block and appends the upstream.
func AddStreamUpstreamToConfig(cfg *model.ConfigFile, upstream model.Node) {
	for i := range cfg.Directives {
		if cfg.Directives[i].Name == "stream" && cfg.Directives[i].Type == model.NodeTypeBlock {
			cfg.Directives[i].Directives = append(cfg.Directives[i].Directives, upstream)
			cfg.EnsureConfigFileIDs()
			return
		}
	}
	cfg.Directives = append(cfg.Directives, model.Node{
		Type:       model.NodeTypeBlock,
		Name:       "stream",
		Args:       []string{},
		Enabled:    true,
		Directives: []model.Node{upstream},
	})
	cfg.EnsureConfigFileIDs()
}

// CreateStreamServerHandler handles POST /api/stream/server.
func CreateStreamServerHandler(sysCfg system.Config, getConfigRoot func() string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateStreamServerRequest
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

		// Build listen args
		listen := req.Listen
		if req.UDP {
			listen += " udp"
		}
		if req.SSL {
			listen += " ssl"
		}

		server := model.Node{
			Type:    model.NodeTypeBlock,
			Name:    "server",
			Args:    []string{},
			Enabled: true,
			Directives: []model.Node{
				{Type: model.NodeTypeDirective, Name: "listen", Args: []string{listen}, Enabled: true},
			},
		}
		if req.ProxyPass != "" {
			server.Directives = append(server.Directives, model.Node{
				Type: model.NodeTypeDirective, Name: "proxy_pass", Args: []string{req.ProxyPass}, Enabled: true,
			})
		}
		if req.ProxyTimeout != "" {
			server.Directives = append(server.Directives, model.Node{
				Type: model.NodeTypeDirective, Name: "proxy_timeout", Args: []string{req.ProxyTimeout}, Enabled: true,
			})
		}
		if req.ProxyConnectTimeout != "" {
			server.Directives = append(server.Directives, model.Node{
				Type: model.NodeTypeDirective, Name: "proxy_connect_timeout", Args: []string{req.ProxyConnectTimeout}, Enabled: true,
			})
		}
		if req.ProxyBufferSize != "" {
			server.Directives = append(server.Directives, model.Node{
				Type: model.NodeTypeDirective, Name: "proxy_buffer_size", Args: []string{req.ProxyBufferSize}, Enabled: true,
			})
		}
		if req.SSLPreread {
			server.Directives = append(server.Directives, model.Node{
				Type: model.NodeTypeDirective, Name: "ssl_preread", Args: []string{"on"}, Enabled: true,
			})
		}
		server.EnsureID()

		AddStreamServerToConfig(cfg, server)
		if err := SaveConfig(sysCfg, root, req.FilePath, cfg); err != nil {
			var ve *ValidationError
			if errors.As(err, &ve) {
				c.JSON(http.StatusBadRequest, gin.H{"error": ve.Error(), "output": ve.Output})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true})
	}
}

// CreateStreamUpstreamHandler handles POST /api/stream/upstream.
func CreateStreamUpstreamHandler(sysCfg system.Config, getConfigRoot func() string) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateStreamUpstreamRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if req.FilePath == "" {
			req.FilePath = "conf.d/default.conf"
		}
		if req.Name == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "name required"})
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
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot load config: " + err.Error()})
			return
		}

		upstream := model.Node{
			Type:       model.NodeTypeBlock,
			Name:       "upstream",
			Args:       []string{req.Name},
			Enabled:    true,
			Directives: []model.Node{},
		}
		for _, addr := range req.Servers {
			if addr != "" {
				upstream.Directives = append(upstream.Directives, model.Node{
					Type:    model.NodeTypeDirective,
					Name:    "server",
					Args:    []string{addr},
					Enabled: true,
				})
			}
		}
		upstream.EnsureID()

		AddStreamUpstreamToConfig(cfg, upstream)
		if err := SaveConfig(sysCfg, root, req.FilePath, cfg); err != nil {
			var ve *ValidationError
			if errors.As(err, &ve) {
				c.JSON(http.StatusBadRequest, gin.H{"error": ve.Error(), "output": ve.Output})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true})
	}
}

// ListStreamServersHandler handles GET /api/stream/servers?file=filename.
func ListStreamServersHandler(getConfigRoot func() string) gin.HandlerFunc {
	return func(c *gin.Context) {
		file := c.Query("file")
		if file == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "file query param required"})
			return
		}
		root := getConfigRoot()
		safePath := paths.SanitizeConfigPath(root, file)
		if safePath == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid file"})
			return
		}
		cfg, err := parser.ParseFromFile(safePath)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		var streamBlock *model.Node
		for i := range cfg.Directives {
			if cfg.Directives[i].Name == "stream" && cfg.Directives[i].Type == model.NodeTypeBlock {
				streamBlock = &cfg.Directives[i]
				break
			}
		}

		if streamBlock == nil {
			c.JSON(http.StatusOK, gin.H{"servers": []model.Node{}, "upstreams": []model.Node{}})
			return
		}

		var servers []model.Node
		var upstreams []model.Node
		for _, d := range streamBlock.Directives {
			if d.Name == "server" {
				servers = append(servers, d)
			} else if d.Name == "upstream" {
				upstreams = append(upstreams, d)
			}
		}
		if servers == nil {
			servers = []model.Node{}
		}
		if upstreams == nil {
			upstreams = []model.Node{}
		}
		c.JSON(http.StatusOK, gin.H{"servers": servers, "upstreams": upstreams})
	}
}
