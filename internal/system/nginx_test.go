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
	if cfg.ReloadMode != ReloadModeSystemctl {
		t.Errorf("ReloadMode = %q, want %q (default)", cfg.ReloadMode, ReloadModeSystemctl)
	}
}

func TestDefaultConfig_ReloadModeEnv(t *testing.T) {
	cases := []struct {
		env  string
		want string
	}{
		{"signal", ReloadModeSignal},
		{"SIGNAL", ReloadModeSignal},
		{"disabled", ReloadModeDisabled},
		{"systemctl", ReloadModeSystemctl},
		{"", ReloadModeSystemctl},       // unset → default
		{"bogus", ReloadModeSystemctl},  // unrecognized → default
	}
	for _, c := range cases {
		t.Run(c.env, func(t *testing.T) {
			if c.env == "" {
				os.Unsetenv("NGINX_RELOAD_MODE")
			} else {
				os.Setenv("NGINX_RELOAD_MODE", c.env)
			}
			defer os.Unsetenv("NGINX_RELOAD_MODE")
			cfg := DefaultConfig()
			if cfg.ReloadMode != c.want {
				t.Errorf("NGINX_RELOAD_MODE=%q → ReloadMode=%q, want %q", c.env, cfg.ReloadMode, c.want)
			}
		})
	}
}

func TestReload_Disabled(t *testing.T) {
	cfg := DefaultConfig()
	cfg.ReloadMode = ReloadModeDisabled
	result := Reload(cfg)
	if result.Success {
		t.Errorf("Reload in disabled mode should return Success=false, got true")
	}
	if result.Message == "" {
		t.Error("Reload in disabled mode should include an explanatory message")
	}
}

func TestStatus_Disabled(t *testing.T) {
	cfg := DefaultConfig()
	cfg.ReloadMode = ReloadModeDisabled
	result := Status(cfg)
	if result.Active {
		t.Errorf("Status in disabled mode should be Active=false, got true")
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
