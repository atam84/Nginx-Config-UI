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
