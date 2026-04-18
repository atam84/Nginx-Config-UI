package serializer

import (
	"strings"
	"testing"

	"github.com/xenos/nginx-config-ui/internal/model"
	"github.com/xenos/nginx-config-ui/internal/parser"
)

func TestSerialize_SimpleDirective(t *testing.T) {
	cfg := &model.ConfigFile{
		FilePath: "test.conf",
		Status:   "enabled",
		Directives: []model.Node{
			{Type: model.NodeTypeDirective, Name: "worker_processes", Args: []string{"auto"}, Enabled: true},
		},
	}
	out := Serialize(cfg)
	expected := "worker_processes auto;\n"
	if out != expected {
		t.Errorf("Serialize() = %q, want %q", out, expected)
	}
}

func TestSerialize_Block(t *testing.T) {
	cfg := &model.ConfigFile{
		FilePath: "test.conf",
		Status:   "enabled",
		Directives: []model.Node{
			{
				Type:   model.NodeTypeBlock,
				Name:   "events",
				Args:   nil,
				Enabled: true,
				Directives: []model.Node{
					{Type: model.NodeTypeDirective, Name: "worker_connections", Args: []string{"1024"}, Enabled: true},
				},
			},
		},
	}
	out := Serialize(cfg)
	expected := `events {
    worker_connections 1024;
}
`
	if out != expected {
		t.Errorf("Serialize() = %q, want %q", out, expected)
	}
}

func TestSerialize_DisabledDirective(t *testing.T) {
	cfg := &model.ConfigFile{
		FilePath: "test.conf",
		Status:   "enabled",
		Directives: []model.Node{
			{Type: model.NodeTypeDirective, Name: "listen", Args: []string{"80"}, Enabled: false},
		},
	}
	out := Serialize(cfg)
	expected := "# listen 80;\n"
	if out != expected {
		t.Errorf("Serialize() = %q, want %q", out, expected)
	}
}

func TestSerialize_DisabledBlock(t *testing.T) {
	cfg := &model.ConfigFile{
		FilePath: "test.conf",
		Status:   "enabled",
		Directives: []model.Node{
			{
				Type:    model.NodeTypeBlock,
				Name:   "server",
				Args:   nil,
				Enabled: false,
				Directives: []model.Node{
					{Type: model.NodeTypeDirective, Name: "listen", Args: []string{"80"}, Enabled: true},
				},
			},
		},
	}
	out := Serialize(cfg)
	if !strings.Contains(out, "# server {") {
		t.Errorf("expected disabled block to have # prefix, got %q", out)
	}
}

func TestSerialize_Comment(t *testing.T) {
	cfg := &model.ConfigFile{
		FilePath: "test.conf",
		Status:   "enabled",
		Directives: []model.Node{
			{
				Type:    model.NodeTypeDirective,
				Name:   "worker_processes",
				Args:   []string{"auto"},
				Comment: "number of worker processes",
				Enabled: true,
			},
		},
	}
	out := Serialize(cfg)
	if !strings.Contains(out, "# number of worker processes") {
		t.Errorf("expected comment in output, got %q", out)
	}
	if !strings.Contains(out, "worker_processes auto;") {
		t.Errorf("expected directive in output, got %q", out)
	}
}

func TestParseSerializeRoundtrip(t *testing.T) {
	conf := `worker_processes auto;
events {
    worker_connections 1024;
}

http {
    server {
        listen 80;
        server_name example.com;
    }
}
`
	cfg, err := parser.ParseFromString(conf, "test.conf")
	if err != nil {
		t.Fatalf("ParseFromString failed: %v", err)
	}

	out := Serialize(cfg)

	// Re-parse and compare structure
	cfg2, err := parser.ParseFromString(out, "test2.conf")
	if err != nil {
		t.Fatalf("Re-parse failed: %v\nOutput was:\n%s", err, out)
	}

	// Same number of top-level directives
	if len(cfg2.Directives) != len(cfg.Directives) {
		t.Errorf("roundtrip: got %d top-level directives, want %d", len(cfg2.Directives), len(cfg.Directives))
	}

	// Verify worker_processes
	var found bool
	for _, d := range cfg2.Directives {
		if d.Name == "worker_processes" && len(d.Args) == 1 && d.Args[0] == "auto" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("roundtrip: worker_processes auto not found in re-parsed config:\n%s", out)
	}
}

// §42.1 — FastCGI directives must round-trip through parser → serializer → parser
// unchanged. gonginx treats fastcgi_* as unknown directives, so this asserts that
// the unknown-directive preservation path keeps all args, ordering, and multi-arg
// shapes intact for the entire PHP-FPM family.
func TestParseSerializeRoundtrip_FastCGI(t *testing.T) {
	conf := `http {
    fastcgi_cache_path /var/cache/nginx/fcgi levels=1:2 keys_zone=PHPCACHE:10m inactive=60m;

    server {
        listen 80;
        server_name php.example.com;
        root /var/www/html;

        location ~ \.php$ {
            fastcgi_pass unix:/run/php/php8.2-fpm.sock;
            fastcgi_index index.php;
            fastcgi_split_path_info ^(.+\.php)(/.+)$;
            include fastcgi_params;
            fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
            fastcgi_param HTTPS $https if_not_empty;
            fastcgi_param PATH_INFO $fastcgi_path_info;
            fastcgi_connect_timeout 60s;
            fastcgi_read_timeout 300s;
            fastcgi_send_timeout 60s;
            fastcgi_buffer_size 16k;
            fastcgi_buffers 16 16k;
            fastcgi_cache PHPCACHE;
            fastcgi_cache_valid 200 301 302 10m;
            fastcgi_cache_key "$scheme$request_method$host$request_uri";
        }

        location ~ \.php-tcp$ {
            fastcgi_pass 127.0.0.1:9000;
            include fastcgi_params;
        }
    }
}
`
	cfg, err := parser.ParseFromString(conf, "test.conf")
	if err != nil {
		t.Fatalf("initial parse failed: %v", err)
	}

	out := Serialize(cfg)
	cfg2, err := parser.ParseFromString(out, "test.conf")
	if err != nil {
		t.Fatalf("re-parse failed: %v\nOutput was:\n%s", err, out)
	}

	// Walk both trees collecting all directive names + args as "name arg1 arg2 …"
	// strings. Order matters — fastcgi_param ordering affects runtime behaviour.
	var flatten func(nodes []model.Node, acc *[]string)
	flatten = func(nodes []model.Node, acc *[]string) {
		for _, n := range nodes {
			*acc = append(*acc, n.Name+" "+strings.Join(n.Args, " "))
			if n.Type == model.NodeTypeBlock {
				flatten(n.Directives, acc)
			}
		}
	}

	var before, after []string
	flatten(cfg.Directives, &before)
	flatten(cfg2.Directives, &after)

	if len(before) != len(after) {
		t.Fatalf("directive count mismatch: before=%d after=%d\n\nbefore:\n%v\n\nafter:\n%v\n\nserialized:\n%s",
			len(before), len(after), before, after, out)
	}
	for i := range before {
		if before[i] != after[i] {
			t.Errorf("directive[%d] mismatch:\n  before: %q\n  after:  %q", i, before[i], after[i])
		}
	}

	// Spot-check the critical FastCGI shapes that commonly break round-trips:
	//   - unix: socket path preserved as single arg
	//   - fastcgi_param with 3 args including `if_not_empty`
	//   - fastcgi_cache_valid with multiple status codes + duration
	//   - fastcgi_cache_key with a quoted value
	mustContain := []string{
		"fastcgi_pass unix:/run/php/php8.2-fpm.sock",
		"fastcgi_pass 127.0.0.1:9000",
		"fastcgi_param HTTPS $https if_not_empty",
		"fastcgi_cache_valid 200 301 302 10m",
		`fastcgi_cache_key "$scheme$request_method$host$request_uri"`,
		"fastcgi_split_path_info ^(.+\\.php)(/.+)$",
		"fastcgi_connect_timeout 60s",
		"fastcgi_read_timeout 300s",
		"fastcgi_send_timeout 60s",
		"fastcgi_cache_path /var/cache/nginx/fcgi levels=1:2 keys_zone=PHPCACHE:10m inactive=60m",
	}
	for _, want := range mustContain {
		if !strings.Contains(out, want) {
			t.Errorf("serialized output missing %q\n\nfull output:\n%s", want, out)
		}
	}
}
