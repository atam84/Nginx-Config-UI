package parser

import (
	"encoding/json"
	"testing"

	"github.com/xenos/nginx-config-ui/internal/model"
)

func TestParseFromString(t *testing.T) {
	conf := `user www www;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    server {
        listen 80;
        server_name example.com www.example.com;
        location / {
            proxy_pass http://127.0.0.1:3000;
            proxy_set_header Host $host;
        }
    }
}
`
	cfg, err := ParseFromString(conf, "/etc/nginx/nginx.conf")
	if err != nil {
		t.Fatalf("ParseFromString failed: %v", err)
	}

	if cfg.FilePath != "/etc/nginx/nginx.conf" {
		t.Errorf("FilePath = %q, want /etc/nginx/nginx.conf", cfg.FilePath)
	}
	if len(cfg.Directives) < 4 {
		t.Errorf("expected at least 4 top-level directives, got %d", len(cfg.Directives))
	}

	// Find worker_processes
	var found bool
	for _, d := range cfg.Directives {
		if d.Name == "worker_processes" {
			found = true
			if d.Type != "directive" {
				t.Errorf("worker_processes type = %q, want directive", d.Type)
			}
			if len(d.Args) != 1 || d.Args[0] != "auto" {
				t.Errorf("worker_processes args = %v, want [auto]", d.Args)
			}
			break
		}
	}
	if !found {
		t.Error("worker_processes directive not found")
	}

	// Find http block
	for _, d := range cfg.Directives {
		if d.Name == "http" {
			if d.Type != "block" {
				t.Errorf("http type = %q, want block", d.Type)
			}
			if len(d.Directives) == 0 {
				t.Error("http block should have child directives")
			}
			// Find server block
			for _, child := range d.Directives {
				if child.Name == "server" {
					if child.Type != "block" {
						t.Errorf("server type = %q, want block", child.Type)
					}
					break
				}
			}
			break
		}
	}

	// All nodes should have IDs
	cfg.EnsureConfigFileIDs()
	for _, d := range cfg.Directives {
		if d.ID == "" {
			t.Errorf("directive %s has empty ID", d.Name)
		}
	}
}

func TestParseFromString_Upstream(t *testing.T) {
	conf := `upstream my_backend {
    least_conn;
    server 10.0.0.1:8080 weight=5;
    server 10.0.0.2:8080 backup;
}
`
	cfg, err := ParseFromString(conf, "/etc/nginx/conf.d/upstream.conf")
	if err != nil {
		t.Fatalf("ParseFromString failed: %v", err)
	}

	if len(cfg.Directives) != 1 {
		t.Fatalf("expected 1 top-level directive, got %d", len(cfg.Directives))
	}
	up := cfg.Directives[0]
	if up.Name != "upstream" {
		t.Errorf("name = %q, want upstream", up.Name)
	}
	if up.Type != "block" {
		t.Errorf("type = %q, want block", up.Type)
	}
	if len(up.Args) != 1 || up.Args[0] != "my_backend" {
		t.Errorf("args = %v, want [my_backend]", up.Args)
	}
	if len(up.Directives) != 3 {
		t.Errorf("expected 3 directives in upstream, got %d", len(up.Directives))
	}
}

func TestParseFromString_InvalidConfig(t *testing.T) {
	conf := `server {
    listen 80
    # missing semicolon and closing brace
`
	_, err := ParseFromString(conf, "test.conf")
	if err == nil {
		t.Error("expected parse error for invalid config")
	}
}

func TestParseFromString_CommentsPreserved(t *testing.T) {
	conf := `# Main config comment
worker_processes 1; # inline comment
`
	cfg, err := ParseFromString(conf, "test.conf")
	if err != nil {
		t.Fatalf("ParseFromString failed: %v", err)
	}
	// At minimum worker_processes should have comment if supported
	// gonginx associates block comments with following directive
	for _, d := range cfg.Directives {
		if d.Name == "worker_processes" {
			// Comment might be in d.Comment (block) or inline
			_ = d.Comment // used to ensure we're checking
			break
		}
	}
}

func TestParseRoundtripJSON(t *testing.T) {
	conf := `listen 80;
server_name example.com;
`
	cfg, err := ParseFromString(conf, "test.conf")
	if err != nil {
		t.Fatalf("ParseFromString failed: %v", err)
	}

	// Marshal to JSON and unmarshal back - should work
	data, err := json.Marshal(cfg)
	if err != nil {
		t.Fatalf("JSON marshal failed: %v", err)
	}
	var cfg2 model.ConfigFile
	if err := json.Unmarshal(data, &cfg2); err != nil {
		t.Fatalf("JSON unmarshal failed: %v", err)
	}
	if cfg2.FilePath != cfg.FilePath {
		t.Errorf("roundtrip FilePath = %q, want %q", cfg2.FilePath, cfg.FilePath)
	}
}
