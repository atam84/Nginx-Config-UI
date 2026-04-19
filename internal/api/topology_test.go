package api

import (
	"os"
	"path/filepath"
	"testing"
)

const topologyFixture = `
user nginx;
events { worker_connections 1024; }
http {
    resolver 1.1.1.1 8.8.8.8;

    upstream api_backend {
        server 10.0.0.1:8080;
        server 10.0.0.2:8080 backup;
    }

    server {
        listen 80;
        server_name example.com www.example.com;
        return 301 https://$host$request_uri;
    }

    server {
        listen 443 ssl http2;
        listen [::]:443 ssl http2;
        server_name api.example.com;
        status_zone api;

        location / {
            proxy_pass http://api_backend;
        }
        location /legacy {
            proxy_pass http://legacy.internal.example.com:8080;
        }
        location /php {
            fastcgi_pass unix:/var/run/php-fpm.sock;
        }
        location /grpc {
            grpc_pass grpcs://grpc-backend.example.com:443;
        }
        location = /nginx_status {
            stub_status;
        }
    }

    # A server without http-level resolver would flag DNS pass as missing resolver,
    # but here we have one so everything is happy.
    server {
        listen 8443 ssl;
        server_name internal.example.com;
        location / {
            proxy_pass http://backend.internal;
        }
    }
}
`

const noResolverFixture = `
events {}
http {
    # No resolver here — DNS-based proxy_pass should warn.
    server {
        listen 80;
        server_name app.example.com;
        location / {
            proxy_pass http://backend.example.com;
        }
        location /ip {
            proxy_pass http://10.0.0.5:8080;
        }
    }
}
`

func writeFixture(t *testing.T, dir, name, body string) {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte(body), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestCollectPublishedEndpoints(t *testing.T) {
	dir := t.TempDir()
	writeFixture(t, dir, "nginx.conf", topologyFixture)
	files := []ConfigFileInfo{{Path: "nginx.conf", Status: "enabled"}}

	resp := CollectPublishedEndpoints(dir, files)
	if len(resp.Endpoints) == 0 {
		t.Fatalf("expected endpoints, got none (warnings=%v)", resp.Warnings)
	}

	// Check: api.example.com:443/ with SSL=true, HTTP2=true
	var foundApi bool
	var foundLegacyProxy bool
	var foundGrpc bool
	for _, e := range resp.Endpoints {
		if e.ServerName == "api.example.com" && e.Path == "/" && e.Port == "443" {
			foundApi = true
			if !e.SSL {
				t.Errorf("api.example.com:443/ should have SSL=true")
			}
			if !e.HTTP2 {
				t.Errorf("api.example.com:443/ should have HTTP2=true")
			}
			if e.Backend != "http://api_backend" {
				t.Errorf("expected backend http://api_backend, got %q", e.Backend)
			}
			if e.BackendKind != "proxy" {
				t.Errorf("expected backend_kind proxy, got %q", e.BackendKind)
			}
		}
		if e.Path == "/legacy" && e.BackendKind == "proxy" {
			foundLegacyProxy = true
		}
		if e.Path == "/grpc" && e.BackendKind == "grpc" {
			foundGrpc = true
		}
	}
	if !foundApi {
		t.Errorf("expected api.example.com:443/ in endpoints:\n%+v", resp.Endpoints)
	}
	if !foundLegacyProxy {
		t.Errorf("expected /legacy proxy endpoint")
	}
	if !foundGrpc {
		t.Errorf("expected /grpc grpc endpoint")
	}
}

func TestCollectOutboundDependencies_ResolverInScope(t *testing.T) {
	dir := t.TempDir()
	writeFixture(t, dir, "nginx.conf", topologyFixture)
	files := []ConfigFileInfo{{Path: "nginx.conf", Status: "enabled"}}

	resp := CollectOutboundDependencies(dir, files)
	if len(resp.Outbound) == 0 {
		t.Fatal("expected outbound deps")
	}
	if _, ok := resp.Upstreams["api_backend"]; !ok {
		t.Errorf("expected api_backend in upstreams: %+v", resp.Upstreams)
	}
	// Since http { resolver ... } is in scope, no deps should report ResolverMissing.
	for _, d := range resp.Outbound {
		if d.ResolverMissing {
			t.Errorf("unexpected ResolverMissing=true for %+v", d)
		}
	}
	// Verify classification: api_backend → upstream; legacy.internal.example.com → host/DNS; unix socket → unix; grpcs → TLS.
	var (
		sawUpstream bool
		sawHost     bool
		sawUnix     bool
		sawTLS      bool
	)
	for _, d := range resp.Outbound {
		if d.TargetKind == "upstream" && d.UpstreamName == "api_backend" {
			sawUpstream = true
		}
		if d.TargetKind == "host" && d.Host == "legacy.internal.example.com" && d.UsesDNS {
			sawHost = true
		}
		if d.TargetKind == "unix" {
			sawUnix = true
		}
		if d.Kind == "grpc" && d.UsesTLS {
			sawTLS = true
		}
	}
	if !sawUpstream {
		t.Errorf("expected upstream match for api_backend")
	}
	if !sawHost {
		t.Errorf("expected host match for legacy.internal.example.com")
	}
	if !sawUnix {
		t.Errorf("expected unix socket target (fastcgi_pass unix:...)")
	}
	if !sawTLS {
		t.Errorf("expected grpcs:// to set UsesTLS=true")
	}
}

func TestCollectOutboundDependencies_ResolverMissingWarning(t *testing.T) {
	dir := t.TempDir()
	writeFixture(t, dir, "nginx.conf", noResolverFixture)
	files := []ConfigFileInfo{{Path: "nginx.conf", Status: "enabled"}}

	resp := CollectOutboundDependencies(dir, files)

	var dnsDep, ipDep *OutboundDependency
	for i, d := range resp.Outbound {
		if d.Host == "backend.example.com" {
			dnsDep = &resp.Outbound[i]
		}
		if d.Host == "10.0.0.5" {
			ipDep = &resp.Outbound[i]
		}
	}
	if dnsDep == nil {
		t.Fatal("expected DNS-based proxy_pass in outbound")
	}
	if !dnsDep.ResolverMissing {
		t.Errorf("DNS proxy_pass without resolver should flag ResolverMissing=true: %+v", dnsDep)
	}
	if ipDep == nil {
		t.Fatal("expected IP-based proxy_pass in outbound")
	}
	if ipDep.ResolverMissing {
		t.Errorf("IP proxy_pass should NOT flag ResolverMissing: %+v", ipDep)
	}
	if ipDep.UsesDNS {
		t.Errorf("IP proxy_pass should have UsesDNS=false")
	}
}
