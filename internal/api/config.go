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

// SaveAllEntry is a single file payload for SaveAllConfigs.
type SaveAllEntry struct {
	Path   string           `json:"path"`
	Config model.ConfigFile `json:"config"`
}

// SaveAllError describes a per-file failure from SaveAllConfigs.
type SaveAllError struct {
	Path   string `json:"path"`
	Error  string `json:"error"`
	Output string `json:"output,omitempty"`
}

// SaveAllConfigs atomically saves multiple config files.
// It validates and serializes each file, writes to temp files in the same directory,
// then renames all at once. On any failure the temp files are removed.
func SaveAllConfigs(sysCfg system.Config, configRoot string, entries []SaveAllEntry) []SaveAllError {
	type prepared struct {
		safePath string
		tempPath string
		content  string
		relPath  string
	}

	var errs []SaveAllError
	preps := make([]prepared, 0, len(entries))

	// Phase 1: validate and serialize
	for _, entry := range entries {
		safePath := paths.SanitizeConfigPath(configRoot, entry.Path)
		if safePath == "" {
			errs = append(errs, SaveAllError{Path: entry.Path, Error: "invalid path"})
			continue
		}
		if err := security.ValidateConfig(&entry.Config); err != nil {
			errs = append(errs, SaveAllError{Path: entry.Path, Error: err.Error()})
			continue
		}
		content := serializer.Serialize(&entry.Config)
		preps = append(preps, prepared{safePath: safePath, content: content, relPath: entry.Path})
	}
	if len(errs) > 0 {
		return errs
	}

	// Phase 2: write to temp files
	for i := range preps {
		tmp, err := os.CreateTemp(filepath.Dir(preps[i].safePath), ".nginx-save-*.conf")
		if err != nil {
			// Clean up already-created temp files
			for j := 0; j < i; j++ {
				os.Remove(preps[j].tempPath)
			}
			return []SaveAllError{{Path: preps[i].relPath, Error: err.Error()}}
		}
		if _, werr := tmp.WriteString(preps[i].content); werr != nil {
			tmp.Close()
			os.Remove(tmp.Name())
			for j := 0; j < i; j++ {
				os.Remove(preps[j].tempPath)
			}
			return []SaveAllError{{Path: preps[i].relPath, Error: werr.Error()}}
		}
		tmp.Close()
		preps[i].tempPath = tmp.Name()
	}

	// Phase 3: validate syntax for each file
	var validErrs []SaveAllError
	for _, p := range preps {
		result, _ := system.ValidateConfigContent(sysCfg, p.content)
		if !result.Success {
			validErrs = append(validErrs, SaveAllError{Path: p.relPath, Error: "validation failed", Output: result.Output})
		}
	}
	if len(validErrs) > 0 {
		for _, p := range preps {
			os.Remove(p.tempPath)
		}
		return validErrs
	}

	// Phase 4: atomic rename temp → final
	var renameErrs []SaveAllError
	for _, p := range preps {
		if err := os.Rename(p.tempPath, p.safePath); err != nil {
			renameErrs = append(renameErrs, SaveAllError{Path: p.relPath, Error: err.Error()})
		}
	}
	// Clean up any remaining temp files (rename may have left some on partial failure)
	for _, p := range preps {
		os.Remove(p.tempPath) // no-op if already renamed
	}
	return renameErrs
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
