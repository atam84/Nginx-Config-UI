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

// §43.1 — uWSGI directives must round-trip through parser → serializer →
// parser unchanged. Same unknown-directive preservation path as FastCGI; this
// test locks in the specific argument shapes the UI emits for Django / Flask
// deployments via uWSGI, including the 3-arg uwsgi_param `if_not_empty` form
// and the 2-arg uwsgi_buffers (count + size).
func TestParseSerializeRoundtrip_Uwsgi(t *testing.T) {
	conf := `http {
    server {
        listen 80;
        server_name django.example.com;

        location /static/ {
            alias /var/www/app/static/;
            expires 30d;
            access_log off;
        }

        location / {
            include uwsgi_params;
            uwsgi_pass unix:/run/uwsgi/app.sock;
            uwsgi_param HTTPS $https if_not_empty;
            uwsgi_param UWSGI_SCHEME $scheme;
            uwsgi_read_timeout 300s;
            uwsgi_buffers 16 16k;
            uwsgi_buffer_size 16k;
            client_max_body_size 25m;
        }

        location /api/ {
            include uwsgi_params;
            uwsgi_pass 127.0.0.1:3031;
            uwsgi_read_timeout 600s;
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
		t.Fatalf("directive count mismatch: before=%d after=%d\n\nserialized:\n%s",
			len(before), len(after), out)
	}
	for i := range before {
		if before[i] != after[i] {
			t.Errorf("directive[%d] mismatch:\n  before: %q\n  after:  %q", i, before[i], after[i])
		}
	}

	mustContain := []string{
		"uwsgi_pass unix:/run/uwsgi/app.sock",
		"uwsgi_pass 127.0.0.1:3031",
		"uwsgi_param HTTPS $https if_not_empty",
		"uwsgi_param UWSGI_SCHEME $scheme",
		"uwsgi_read_timeout 300s",
		"uwsgi_read_timeout 600s",
		"uwsgi_buffers 16 16k",
		"include uwsgi_params",
	}
	for _, want := range mustContain {
		if !strings.Contains(out, want) {
			t.Errorf("serialized output missing %q\n\nfull output:\n%s", want, out)
		}
	}
}

// §44.1 — gRPC directives must round-trip through parser → serializer →
// parser unchanged. Covers the schemes (grpc:// and grpcs://), multi-arg
// grpc_set_header, the grpc_ssl_* TLS bundle, and the http2 flag on listen
// that the UI auto-enforces.
func TestParseSerializeRoundtrip_Grpc(t *testing.T) {
	conf := `http {
    server {
        listen 443 ssl http2;
        server_name grpc.example.com;

        ssl_certificate /etc/ssl/grpc.example.com.crt;
        ssl_certificate_key /etc/ssl/grpc.example.com.key;

        location / {
            grpc_pass grpc://127.0.0.1:50051;
            grpc_set_header Host $host;
            grpc_set_header X-Real-IP $remote_addr;
            grpc_set_header X-Grpc-Client-Id $http_x_client_id;
            grpc_read_timeout 3600s;
            grpc_send_timeout 600s;
            client_max_body_size 0;
        }

        location /secure.Service/ {
            grpc_pass grpcs://service.internal:443;
            grpc_ssl_server_name service.internal;
            grpc_ssl_verify on;
            grpc_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
            grpc_ssl_certificate /etc/ssl/client/client.crt;
            grpc_ssl_certificate_key /etc/ssl/client/client.key;
            grpc_read_timeout 300s;
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
		t.Fatalf("directive count mismatch: before=%d after=%d\n\nserialized:\n%s",
			len(before), len(after), out)
	}
	for i := range before {
		if before[i] != after[i] {
			t.Errorf("directive[%d] mismatch:\n  before: %q\n  after:  %q", i, before[i], after[i])
		}
	}

	mustContain := []string{
		"listen 443 ssl http2",
		"grpc_pass grpc://127.0.0.1:50051",
		"grpc_pass grpcs://service.internal:443",
		"grpc_set_header Host $host",
		"grpc_set_header X-Grpc-Client-Id $http_x_client_id",
		"grpc_read_timeout 3600s",
		"grpc_send_timeout 600s",
		"grpc_ssl_server_name service.internal",
		"grpc_ssl_verify on",
		"grpc_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt",
		"grpc_ssl_certificate /etc/ssl/client/client.crt",
		"grpc_ssl_certificate_key /etc/ssl/client/client.key",
	}
	for _, want := range mustContain {
		if !strings.Contains(out, want) {
			t.Errorf("serialized output missing %q\n\nfull output:\n%s", want, out)
		}
	}
}

// §51 — Brotli + gzip_static + gunzip round-trip. Brotli directives come from
// the third-party ngx_brotli module so they MUST go through the generic
// unknown-directive preservation path without mangling. Also covers gzip_static
// tri-state (`on` / `always` / absent) and gunzip.
func TestParseSerializeRoundtrip_Compression(t *testing.T) {
	conf := `http {
    gzip on;
    gzip_vary on;
    gzip_comp_level 5;
    gzip_min_length 256;
    gzip_proxied any;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_static on;
    gunzip on;

    brotli on;
    brotli_comp_level 5;
    brotli_types text/css application/javascript application/json image/svg+xml application/wasm;
    brotli_static always;

    server {
        listen 80;
        location / {
            proxy_pass http://127.0.0.1:8080;
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
		t.Fatalf("directive count mismatch: before=%d after=%d\n\nserialized:\n%s",
			len(before), len(after), out)
	}
	for i := range before {
		if before[i] != after[i] {
			t.Errorf("directive[%d] mismatch:\n  before: %q\n  after:  %q", i, before[i], after[i])
		}
	}

	mustContain := []string{
		"gzip on",
		"gzip_static on",
		"gunzip on",
		"brotli on",
		"brotli_comp_level 5",
		"brotli_types text/css application/javascript application/json image/svg+xml application/wasm",
		"brotli_static always",
	}
	for _, want := range mustContain {
		if !strings.Contains(out, want) {
			t.Errorf("serialized output missing %q\n\nfull output:\n%s", want, out)
		}
	}
}

// §50 — HTTP/3 + QUIC round-trip. Locks in that the quic/reuseport listen flags
// plus server-level http3/http3_hq/quic_retry/ssl_early_data/ssl_reject_handshake
// directives survive parse → serialize → re-parse. The quoted Alt-Svc value with
// an embedded double-quoted port ('h3=":443"; ma=86400') is the interesting case
// since the parser must preserve quoting exactly for nginx -t to accept it.
func TestParseSerializeRoundtrip_Http3(t *testing.T) {
	conf := `http {
    server {
        listen 443 ssl;
        listen 443 quic reuseport;
        server_name h3.example.com;

        http3 on;
        quic_retry on;
        ssl_early_data on;

        ssl_certificate /etc/ssl/h3.example.com.crt;
        ssl_certificate_key /etc/ssl/h3.example.com.key;
        ssl_protocols TLSv1.3;

        add_header Alt-Svc 'h3=":443"; ma=86400' always;

        location / {
            proxy_pass http://127.0.0.1:8080;
        }
    }

    server {
        listen 443 ssl default_server;
        ssl_reject_handshake on;
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
		t.Fatalf("directive count mismatch: before=%d after=%d\n\nserialized:\n%s",
			len(before), len(after), out)
	}
	for i := range before {
		if before[i] != after[i] {
			t.Errorf("directive[%d] mismatch:\n  before: %q\n  after:  %q", i, before[i], after[i])
		}
	}

	mustContain := []string{
		"listen 443 ssl",
		"listen 443 quic reuseport",
		"http3 on",
		"quic_retry on",
		"ssl_early_data on",
		"ssl_reject_handshake on",
		`add_header Alt-Svc 'h3=":443"; ma=86400' always`,
	}
	for _, want := range mustContain {
		if !strings.Contains(out, want) {
			t.Errorf("serialized output missing %q\n\nfull output:\n%s", want, out)
		}
	}
}

// §49.2 — split_clients {} round-trip. Exercises the generic unknown-block path:
// quoted source key with a variable expansion, percentage directive names
// (`5%`, `0.5%`), the `*` catch-all fallback, and quoted string values. The
// parser must keep the quotes so the re-serialized directive stays valid for
// nginx -t.
func TestParseSerializeRoundtrip_SplitClients(t *testing.T) {
	conf := `http {
    split_clients "${remote_addr}AAA" $variant {
        0.5%   "v_canary";
        5%     "v1";
        10%    "v2";
        *      "v0";
    }

    split_clients "${http_user_agent}${remote_addr}" $backend_pool {
        25%    "pool_a";
        25%    "pool_b";
        *      "pool_default";
    }

    server {
        listen 80;
        location / {
            proxy_pass http://$backend_pool;
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
		t.Fatalf("directive count mismatch: before=%d after=%d\n\nserialized:\n%s",
			len(before), len(after), out)
	}
	for i := range before {
		if before[i] != after[i] {
			t.Errorf("directive[%d] mismatch:\n  before: %q\n  after:  %q", i, before[i], after[i])
		}
	}

	mustContain := []string{
		`split_clients "${remote_addr}AAA" $variant`,
		`split_clients "${http_user_agent}${remote_addr}" $backend_pool`,
		`0.5% "v_canary"`,
		`5% "v1"`,
		`10% "v2"`,
		`25% "pool_a"`,
		`* "v0"`,
		`* "pool_default"`,
	}
	for _, want := range mustContain {
		if !strings.Contains(out, want) {
			t.Errorf("serialized output missing %q\n\nfull output:\n%s", want, out)
		}
	}
}

// §52 — Observability round-trip. Locks in that the stub_status endpoint
// (helper-generated shape: explicit-match location + allow/deny ACL +
// access_log off), the Nginx Plus `status_zone` on server and `zone` on
// upstream, and the JSON log_format (escape=json + quoted `{...}` body)
// all survive parse → serialize → re-parse. The log_format case is the
// interesting one since the JSON blob contains curly braces, colons, and
// embedded double quotes, all inside single-quoted wrapper — the parser
// must keep it as one token or nginx -t will reject on re-parse.
func TestParseSerializeRoundtrip_Observability(t *testing.T) {
	conf := `http {
    log_format main_json escape=json '{"time":"$time_iso8601","status":"$status","uri":"$request_uri","upstream_response_time":"$upstream_response_time"}';
    access_log /var/log/nginx/access.log main_json;

    upstream backend {
        zone backend 64k;
        server 10.0.0.1:8080;
        server 10.0.0.2:8080;
        keepalive 32;
    }

    server {
        listen 80;
        server_name api.example.com;
        status_zone api.example.com;
        error_log /var/log/nginx/error.log warn;

        location = /nginx_status {
            stub_status;
            access_log off;
            allow 127.0.0.1;
            allow ::1;
            deny all;
        }

        location / {
            proxy_pass http://backend;
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
		t.Fatalf("directive count mismatch: before=%d after=%d\n\nserialized:\n%s",
			len(before), len(after), out)
	}
	for i := range before {
		if before[i] != after[i] {
			t.Errorf("directive[%d] mismatch:\n  before: %q\n  after:  %q", i, before[i], after[i])
		}
	}

	mustContain := []string{
		`stub_status`,
		`access_log off`,
		`allow 127.0.0.1`,
		`allow ::1`,
		`deny all`,
		`status_zone api.example.com`,
		`zone backend 64k`,
		`log_format main_json escape=json`,
		`"time":"$time_iso8601"`,
		`access_log /var/log/nginx/access.log main_json`,
	}
	for _, want := range mustContain {
		if !strings.Contains(out, want) {
			t.Errorf("serialized output missing %q\n\nfull output:\n%s", want, out)
		}
	}
}

// §54 — Ingress Advanced round-trip. Locks in that:
//   - `satisfy any` sits correctly on both server and location scope when
//     mixing auth_basic + allow/deny (needed so the Access Control UI can
//     toggle the composition rule without breaking the config);
//   - `limit_req_status 429` and `limit_conn_status 429` round-trip (RFC-6585
//     Too Many Requests — commonly preferred over default 503);
//   - `limit_req zone=api burst=20 delay=5` round-trips with all three tuning
//     args intact (the delay= form is the tricky one — mutually exclusive
//     with `nodelay`);
//   - `health_check interval=5s fails=3 passes=2 uri=/healthz match=api_healthy`
//     and the sibling `match api_healthy { status 200; body ~ "ok"; header X-Status ~ "live"; }`
//     block both survive, since the UI needs exact preservation for Save+Reload
//     on Nginx Plus to actually work.
func TestParseSerializeRoundtrip_IngressAdvanced(t *testing.T) {
	conf := `http {
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_conn_zone $binary_remote_addr zone=perip:10m;

    match api_healthy {
        status 200;
        body ~ "ok";
        header X-Status ~ "live";
    }

    upstream api_backend {
        zone api_backend 64k;
        server 10.0.0.1:8080;
        server 10.0.0.2:8080;
        health_check interval=5s fails=3 passes=2 uri=/healthz match=api_healthy mandatory persistent;
    }

    server {
        listen 443 ssl;
        server_name api.example.com;

        auth_basic "Restricted";
        auth_basic_user_file /etc/nginx/.htpasswd;
        allow 10.0.0.0/8;
        deny all;
        satisfy any;
        limit_req zone=api burst=20 delay=5;
        limit_req_status 429;
        limit_conn perip 10;
        limit_conn_status 429;

        location /api {
            auth_request /auth;
            allow 192.168.0.0/16;
            deny all;
            satisfy all;
            limit_req zone=api burst=5 nodelay;
            proxy_pass http://api_backend;
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
		t.Fatalf("directive count mismatch: before=%d after=%d\n\nserialized:\n%s",
			len(before), len(after), out)
	}
	for i := range before {
		if before[i] != after[i] {
			t.Errorf("directive[%d] mismatch:\n  before: %q\n  after:  %q", i, before[i], after[i])
		}
	}

	mustContain := []string{
		`satisfy any`,
		`satisfy all`,
		`limit_req zone=api burst=20 delay=5`,
		`limit_req zone=api burst=5 nodelay`,
		`limit_req_status 429`,
		`limit_conn perip 10`,
		`limit_conn_status 429`,
		`health_check interval=5s fails=3 passes=2 uri=/healthz match=api_healthy mandatory persistent`,
		`match api_healthy`,
		`status 200`,
		`body ~ "ok"`,
		`header X-Status ~ "live"`,
	}
	for _, want := range mustContain {
		if !strings.Contains(out, want) {
			t.Errorf("serialized output missing %q\n\nfull output:\n%s", want, out)
		}
	}
}

// §55 — Egress Tuning round-trip. Locks in that:
//   - Multi-condition `proxy_next_upstream error timeout http_502 http_503 non_idempotent`
//     survives with argument order preserved — the UI emits a stable order so
//     diffs stay small across edits.
//   - `proxy_next_upstream_tries 3` and `proxy_next_upstream_timeout 10s`
//     round-trip alongside.
//   - `resolve` on an upstream server arg (`server api.example.com:8080 resolve;`)
//     survives as a flag token (no `=`).
//   - `resolver 1.1.1.1 8.8.8.8 valid=300s ipv6=off status_zone=dns;` (http-level,
//     with the Plus-only status_zone tag mixed with the OSS valid/ipv6 tags).
//   - `resolver_timeout 5s` and per-server `resolver 9.9.9.9;` (server-level
//     override) coexist without conflict.
func TestParseSerializeRoundtrip_EgressTuning(t *testing.T) {
	conf := `http {
    resolver 1.1.1.1 8.8.8.8 valid=300s ipv6=off status_zone=dns;
    resolver_timeout 5s;

    upstream api_backend {
        zone api_backend 64k;
        server api.example.com:8080 resolve;
        server backup.example.com:8080 resolve backup;
        server 10.0.0.5:8080;
    }

    server {
        listen 443 ssl;
        server_name api.example.com;
        resolver 9.9.9.9 valid=60s;
        resolver_timeout 2s;

        proxy_next_upstream error timeout http_502 http_503 non_idempotent;
        proxy_next_upstream_tries 3;
        proxy_next_upstream_timeout 10s;

        location /api {
            proxy_next_upstream off;
            proxy_next_upstream_tries 0;
            proxy_pass http://api_backend;
        }

        location /soft {
            proxy_next_upstream error timeout http_502;
            proxy_pass http://api_backend;
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
		t.Fatalf("directive count mismatch: before=%d after=%d\n\nserialized:\n%s",
			len(before), len(after), out)
	}
	for i := range before {
		if before[i] != after[i] {
			t.Errorf("directive[%d] mismatch:\n  before: %q\n  after:  %q", i, before[i], after[i])
		}
	}

	mustContain := []string{
		`resolver 1.1.1.1 8.8.8.8 valid=300s ipv6=off status_zone=dns`,
		`resolver_timeout 5s`,
		`resolver 9.9.9.9 valid=60s`,
		`resolver_timeout 2s`,
		`server api.example.com:8080 resolve`,
		`server backup.example.com:8080 resolve backup`,
		`proxy_next_upstream error timeout http_502 http_503 non_idempotent`,
		`proxy_next_upstream_tries 3`,
		`proxy_next_upstream_timeout 10s`,
		`proxy_next_upstream off`,
		`proxy_next_upstream_tries 0`,
		`proxy_next_upstream error timeout http_502`,
	}
	for _, want := range mustContain {
		if !strings.Contains(out, want) {
			t.Errorf("serialized output missing %q\n\nfull output:\n%s", want, out)
		}
	}
}
