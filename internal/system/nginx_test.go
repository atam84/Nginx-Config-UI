package system

import (
	"os"
	"testing"
)

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()
	if cfg.NginxBin != "nginx" {
		t.Errorf("NginxBin = %q, want nginx", cfg.NginxBin)
	}
	if cfg.NginxService != "nginx" {
		t.Errorf("NginxService = %q, want nginx", cfg.NginxService)
	}
}

func TestDefaultConfig_EnvOverride(t *testing.T) {
	os.Setenv("NGINX_BIN", "nginx-custom")
	os.Setenv("NGINX_CONFIG_ROOT", "/custom/nginx")
	defer os.Unsetenv("NGINX_BIN")
	defer os.Unsetenv("NGINX_CONFIG_ROOT")

	cfg := DefaultConfig()
	if cfg.NginxBin != "nginx-custom" {
		t.Errorf("NginxBin = %q, want nginx-custom", cfg.NginxBin)
	}
	if cfg.ConfigRoot != "/custom/nginx" {
		t.Errorf("ConfigRoot = %q, want /custom/nginx", cfg.ConfigRoot)
	}
}

func TestTestConfig(t *testing.T) {
	cfg := DefaultConfig()
	result := TestConfig(cfg)
	// May succeed or fail depending on nginx install - just ensure no panic
	_ = result.Success
	_ = result.Output
}

func TestStatus(t *testing.T) {
	cfg := DefaultConfig()
	result := Status(cfg)
	_ = result.Active
	_ = result.Output
}
