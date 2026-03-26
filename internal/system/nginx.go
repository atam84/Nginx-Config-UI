package system

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// Config holds paths for nginx and systemctl.
type Config struct {
	NginxBin      string // e.g. "nginx"
	NginxService  string // e.g. "nginx"
	ConfigRoot    string // e.g. "/etc/nginx"
	SystemctlBin  string // e.g. "systemctl"
}

// DefaultConfig returns config from env or defaults.
func DefaultConfig() Config {
	cfg := Config{
		NginxBin:     "nginx",
		NginxService: "nginx",
		ConfigRoot:   "/etc/nginx",
		SystemctlBin: "systemctl",
	}
	if v := os.Getenv("NGINX_BIN"); v != "" {
		cfg.NginxBin = v
	}
	if v := os.Getenv("NGINX_SERVICE"); v != "" {
		cfg.NginxService = v
	}
	if v := os.Getenv("NGINX_CONFIG_ROOT"); v != "" {
		cfg.ConfigRoot = v
	}
	if v := os.Getenv("SYSTEMCTL_BIN"); v != "" {
		cfg.SystemctlBin = v
	}
	return cfg
}

// TestResult holds the outcome of nginx -t.
type TestResult struct {
	Success bool
	Output  string
}

// TestConfig runs `nginx -t` against the default config.
func TestConfig(cfg Config) TestResult {
	cmd := exec.Command(cfg.NginxBin, "-t")
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	err := cmd.Run()
	return TestResult{
		Success: err == nil,
		Output:  out.String(),
	}
}

// TestConfigFile runs `nginx -t -c path` to validate a specific config file.
// Used for pre-save validation.
func TestConfigFile(cfg Config, configPath string) TestResult {
	cmd := exec.Command(cfg.NginxBin, "-t", "-c", configPath)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	err := cmd.Run()
	return TestResult{
		Success: err == nil,
		Output:  out.String(),
	}
}

// ReloadResult holds the outcome of a reload attempt.
type ReloadResult struct {
	Success bool
	Message string
}

// Reload runs config test first, then systemctl reload nginx.
func Reload(cfg Config) ReloadResult {
	test := TestConfig(cfg)
	if !test.Success {
		return ReloadResult{
			Success: false,
			Message: "Config test failed: " + test.Output,
		}
	}
	cmd := exec.Command(cfg.SystemctlBin, "reload", cfg.NginxService)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	err := cmd.Run()
	if err != nil {
		return ReloadResult{
			Success: false,
			Message: fmt.Sprintf("Reload failed: %v %s", err, out.String()),
		}
	}
	return ReloadResult{
		Success: true,
		Message: test.Output + "Reload successful.",
	}
}

// StatusResult holds the service status.
type StatusResult struct {
	Active bool   // true if "active"
	Output string // raw output from systemctl is-active
}

// Status runs `systemctl is-active nginx`.
func Status(cfg Config) StatusResult {
	cmd := exec.Command(cfg.SystemctlBin, "is-active", cfg.NginxService)
	out, err := cmd.Output()
	output := string(out)
	if err != nil {
		// Exit code 3 = inactive, others = error
		return StatusResult{Active: false, Output: strings.TrimSpace(output)}
	}
	return StatusResult{
		Active: strings.TrimSpace(output) == "active",
		Output: strings.TrimSpace(output),
	}
}
