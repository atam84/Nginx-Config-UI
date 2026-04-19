package system

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

// Reload-mode values. Chosen by the NGINX_RELOAD_MODE env var so the same
// binary can run as a systemd-managed service on a VM (default), inside a
// container where it owns nginx directly via signals, or in editor-only mode
// where it never touches a running nginx at all.
const (
	ReloadModeSystemctl = "systemctl"
	ReloadModeSignal    = "signal"
	ReloadModeDisabled  = "disabled"
)

// Config holds paths for nginx and systemctl plus the reload strategy.
type Config struct {
	NginxBin     string // e.g. "nginx"
	NginxService string // e.g. "nginx"
	ConfigRoot   string // e.g. "/etc/nginx"
	SystemctlBin string // e.g. "systemctl"
	ReloadMode   string // ReloadModeSystemctl (default) | ReloadModeSignal | ReloadModeDisabled
}

// DefaultConfig returns config from env or defaults.
func DefaultConfig() Config {
	cfg := Config{
		NginxBin:     "nginx",
		NginxService: "nginx",
		ConfigRoot:   "/etc/nginx",
		SystemctlBin: "systemctl",
		ReloadMode:   ReloadModeSystemctl,
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
	if v := strings.ToLower(strings.TrimSpace(os.Getenv("NGINX_RELOAD_MODE"))); v != "" {
		switch v {
		case ReloadModeSystemctl, ReloadModeSignal, ReloadModeDisabled:
			cfg.ReloadMode = v
		}
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

// Reload validates the config first, then triggers a reload via whichever
// mechanism is configured. Editor mode short-circuits with a clear message
// so the UI can explain why the button did nothing.
func Reload(cfg Config) ReloadResult {
	if cfg.ReloadMode == ReloadModeDisabled {
		return ReloadResult{
			Success: false,
			Message: "Reload is disabled in editor-only mode. Download the config or save it to a managed nginx to apply changes.",
		}
	}

	test := TestConfig(cfg)
	if !test.Success {
		return ReloadResult{
			Success: false,
			Message: "Config test failed: " + test.Output,
		}
	}

	var cmd *exec.Cmd
	switch cfg.ReloadMode {
	case ReloadModeSignal:
		// In-container / self-managed nginx: tell nginx to reload via its own
		// master-worker signalling (SIGHUP from the nginx binary to the pidfile).
		cmd = exec.Command(cfg.NginxBin, "-s", "reload")
	default:
		// Systemd-managed host nginx.
		cmd = exec.Command(cfg.SystemctlBin, "reload", cfg.NginxService)
	}

	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
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

// Status checks whether the managed nginx is running. The check mirrors the
// reload strategy: systemctl in classic VM deploys, pgrep when we signal the
// binary directly, and a static "unmanaged" response in editor-only mode.
func Status(cfg Config) StatusResult {
	switch cfg.ReloadMode {
	case ReloadModeDisabled:
		return StatusResult{Active: false, Output: "unmanaged (editor-only mode)"}

	case ReloadModeSignal:
		// Read the pid nginx writes when it daemonizes and verify the process is
		// alive and is actually nginx. Avoids relying on pgrep: BusyBox pgrep -x
		// matches the full cmdline ("nginx: master process nginx"), not comm,
		// so `pgrep -x nginx` returns no match inside the Alpine container.
		if nginxPidAlive() {
			return StatusResult{Active: true, Output: "active"}
		}
		return StatusResult{Active: false, Output: "inactive"}

	default:
		cmd := exec.Command(cfg.SystemctlBin, "is-active", cfg.NginxService)
		out, err := cmd.Output()
		output := strings.TrimSpace(string(out))
		if err != nil {
			// Exit code 3 = inactive, others = error
			return StatusResult{Active: false, Output: output}
		}
		return StatusResult{
			Active: output == "active",
			Output: output,
		}
	}
}

func nginxPidAlive() bool {
	for _, path := range []string{"/run/nginx.pid", "/var/run/nginx.pid"} {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
		if err != nil || pid <= 0 {
			continue
		}
		comm, err := os.ReadFile(fmt.Sprintf("/proc/%d/comm", pid))
		if err != nil {
			continue
		}
		if strings.TrimSpace(string(comm)) == "nginx" {
			return true
		}
	}
	return false
}
