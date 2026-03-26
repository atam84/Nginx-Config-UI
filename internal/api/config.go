package api

import (
	"os"
	"path/filepath"

	"github.com/xenos/nginx-config-ui/internal/model"
	"github.com/xenos/nginx-config-ui/internal/paths"
	"github.com/xenos/nginx-config-ui/internal/security"
	"github.com/xenos/nginx-config-ui/internal/serializer"
	"github.com/xenos/nginx-config-ui/internal/system"
)

// ConfigFileInfo holds path and enabled status for a config file.
type ConfigFileInfo struct {
	Path   string `json:"path"`
	Status string `json:"status"` // "enabled" or "disabled"
}

// ListConfigFiles returns config files with status from nginx.conf, conf.d, and sites-available.
// For sites-available, status is derived from symlink presence in sites-enabled.
func ListConfigFiles(configRoot string) ([]ConfigFileInfo, error) {
	var files []ConfigFileInfo
	configRoot = filepath.Clean(configRoot)

	sitesEnabledDir := filepath.Join(configRoot, "sites-enabled")
	enabledNames := readEnabledSiteNames(sitesEnabledDir)

	// Main nginx.conf
	mainConf := filepath.Join(configRoot, "nginx.conf")
	if _, err := os.Stat(mainConf); err == nil {
		files = append(files, ConfigFileInfo{Path: "nginx.conf", Status: "enabled"})
	}

	// conf.d/*.conf — always enabled (direct include)
	confd := filepath.Join(configRoot, "conf.d")
	if fi, err := os.Stat(confd); err == nil && fi.IsDir() {
		matches, _ := filepath.Glob(filepath.Join(confd, "*.conf"))
		for _, p := range matches {
			rel, _ := filepath.Rel(configRoot, p)
			if rel != "" && rel != ".." {
				files = append(files, ConfigFileInfo{Path: rel, Status: "enabled"})
			}
		}
	}

	// sites-available/*.conf — status from symlink in sites-enabled
	sitesAvailable := filepath.Join(configRoot, "sites-available")
	if fi, err := os.Stat(sitesAvailable); err == nil && fi.IsDir() {
		entries, _ := os.ReadDir(sitesAvailable)
		for _, e := range entries {
			if !e.IsDir() && filepath.Ext(e.Name()) == ".conf" {
				rel := filepath.Join("sites-available", e.Name())
				status := "disabled"
				if enabledNames[e.Name()] {
					status = "enabled"
				}
				files = append(files, ConfigFileInfo{Path: rel, Status: status})
			}
		}
	}

	return files, nil
}

// readEnabledSiteNames returns a set of filenames that have symlinks in sites-enabled.
func readEnabledSiteNames(sitesEnabled string) map[string]bool {
	out := make(map[string]bool)
	entries, err := os.ReadDir(sitesEnabled)
	if err != nil {
		return out
	}
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".conf" {
			out[e.Name()] = true
		}
	}
	return out
}

// FileStatus returns "enabled" or "disabled" for a given relative path.
func FileStatus(configRoot, relPath string) string {
	configRoot = filepath.Clean(configRoot)
	base := filepath.Base(relPath)

	// conf.d and nginx.conf are always enabled
	if filepath.Dir(relPath) == "conf.d" || relPath == "nginx.conf" {
		return "enabled"
	}

	// sites-available: check symlink in sites-enabled
	if filepath.Dir(relPath) == "sites-available" {
		symPath := filepath.Join(configRoot, "sites-enabled", base)
		if fi, err := os.Lstat(symPath); err == nil && fi.Mode()&os.ModeSymlink != 0 {
			return "enabled"
		}
		return "disabled"
	}

	return "enabled"
}

// SaveConfig validates content (IPs, ports, nginx syntax), then writes to path.
func SaveConfig(sysCfg system.Config, configRoot, relPath string, cfg *model.ConfigFile) error {
	safePath := paths.SanitizeConfigPath(configRoot, relPath)
	if safePath == "" {
		return ErrInvalidPath
	}
	if err := security.ValidateConfig(cfg); err != nil {
		return err
	}
	content := serializer.Serialize(cfg)
	result, _ := system.ValidateConfigContent(sysCfg, content)
	if !result.Success {
		return &ValidationError{Output: result.Output}
	}
	return os.WriteFile(safePath, []byte(content), 0644)
}

// CreateConfig creates a new empty config file in conf.d or sites-available.
func CreateConfig(configRoot, filename, targetDir string) (string, error) {
	sanitized := security.SanitizeConfigFilename(filename)
	if sanitized == "" {
		filename = "new-site.conf"
	} else {
		filename = sanitized
	}
	// targetDir: "conf.d" (default) or "sites-available"
	if targetDir != "sites-available" {
		targetDir = "conf.d"
	}
	relPath := filepath.Join(targetDir, filename)
	safePath := paths.SanitizeConfigPath(configRoot, relPath)
	if safePath == "" {
		safePath = paths.SanitizeConfigPath(configRoot, filename)
	}
	if safePath == "" {
		return "", ErrInvalidPath
	}
	if err := os.MkdirAll(filepath.Dir(safePath), 0755); err != nil {
		return "", err
	}
	if _, err := os.Stat(safePath); err == nil {
		return "", ErrFileExists
	}
	return relPath, os.WriteFile(safePath, []byte("# New nginx config\n"), 0644)
}

// DeleteConfig removes a config file. For sites-available, also removes symlink in sites-enabled.
func DeleteConfig(configRoot, relPath string) error {
	safePath := paths.SanitizeConfigPath(configRoot, relPath)
	if safePath == "" {
		return ErrInvalidPath
	}
	// Prevent deleting main nginx.conf
	if filepath.Base(safePath) == "nginx.conf" && filepath.Dir(safePath) == configRoot {
		return ErrCannotDeleteMain
	}
	// Remove symlink in sites-enabled if this is a sites-available file
	if filepath.Dir(relPath) == "sites-available" {
		symPath := filepath.Join(configRoot, "sites-enabled", filepath.Base(relPath))
		_ = os.Remove(symPath) // ignore error if symlink doesn't exist
	}
	return os.Remove(safePath)
}

// EnableConfig creates a symlink in sites-enabled pointing to sites-available/{filename}.
func EnableConfig(configRoot, relPath string) error {
	if filepath.Dir(relPath) != "sites-available" {
		return ErrNotSitesAvailable
	}
	srcPath := paths.SanitizeConfigPath(configRoot, relPath)
	if srcPath == "" {
		return ErrInvalidPath
	}
	sitesEnabled := filepath.Join(configRoot, "sites-enabled")
	symPath := filepath.Join(sitesEnabled, filepath.Base(relPath))
	if err := os.MkdirAll(sitesEnabled, 0755); err != nil {
		return err
	}
	// Create relative symlink: ../sites-available/filename
	relTarget := filepath.Join("..", "sites-available", filepath.Base(relPath))
	return os.Symlink(relTarget, symPath)
}

// DisableConfig removes the symlink from sites-enabled.
func DisableConfig(configRoot, relPath string) error {
	if filepath.Dir(relPath) != "sites-available" {
		return ErrNotSitesAvailable
	}
	symPath := filepath.Join(configRoot, "sites-enabled", filepath.Base(relPath))
	if err := os.Remove(symPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

var (
	ErrInvalidPath      = &ConfigError{Msg: "invalid path"}
	ErrFileExists       = &ConfigError{Msg: "file already exists"}
	ErrCannotDeleteMain = &ConfigError{Msg: "cannot delete main nginx.conf"}
	ErrNotSitesAvailable = &ConfigError{Msg: "enable/disable only applies to sites-available files"}
)

type ConfigError struct{ Msg string }
func (e *ConfigError) Error() string { return e.Msg }

type ValidationError struct{ Output string }
func (e *ValidationError) Error() string { return "validation failed: " + e.Output }
