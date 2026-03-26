package api

import (
	"github.com/xenos/nginx-config-ui/internal/model"
)

// AddServerToConfig inserts a server block into the config. Finds http block and appends server.
func AddServerToConfig(cfg *model.ConfigFile, server model.Node) {
	for i := range cfg.Directives {
		if cfg.Directives[i].Name == "http" && cfg.Directives[i].Type == model.NodeTypeBlock {
			cfg.Directives[i].Directives = append(cfg.Directives[i].Directives, server)
			cfg.EnsureConfigFileIDs()
			return
		}
	}
	// No http block - create one with the server
	cfg.Directives = append(cfg.Directives, model.Node{
		Type:       model.NodeTypeBlock,
		Name:       "http",
		Args:       []string{},
		Enabled:    true,
		Directives: []model.Node{server},
	})
	cfg.EnsureConfigFileIDs()
}

// CreateServerRequest is the payload for creating a server block.
type CreateServerRequest struct {
	FilePath    string   `json:"file_path"`
	Listen      string   `json:"listen"`
	ServerName  []string `json:"server_name"`
	SSL         bool     `json:"ssl"`
	HTTP2       bool     `json:"http2"`
	Destination string   `json:"destination"` // e.g. http://127.0.0.1:3000
	Websockets  bool     `json:"websockets"`
}

// CreateServerBlock builds a server block node from the request.
func CreateServerBlock(req *CreateServerRequest) model.Node {
	listenArgs := []string{req.Listen}
	if req.Listen == "" {
		if req.SSL {
			listenArgs = []string{"443", "ssl"}
		} else {
			listenArgs = []string{"80"}
		}
	}
	if req.SSL {
		found := false
		for _, a := range listenArgs {
			if a == "ssl" {
				found = true
				break
			}
		}
		if !found {
			listenArgs = append(listenArgs, "ssl")
		}
	}
	if req.HTTP2 {
		listenArgs = append(listenArgs, "http2")
	}

	server := model.Node{
		Type:    model.NodeTypeBlock,
		Name:    "server",
		Args:    []string{},
		Enabled: true,
		Directives: []model.Node{
			{Type: model.NodeTypeDirective, Name: "listen", Args: listenArgs, Enabled: true},
		},
	}
	if len(req.ServerName) > 0 {
		server.Directives = append(server.Directives, model.Node{
			Type: model.NodeTypeDirective, Name: "server_name", Args: req.ServerName, Enabled: true,
		})
	}
	if req.Destination != "" {
		loc := model.Node{
			Type:    model.NodeTypeBlock,
			Name:    "location",
			Args:    []string{"/"},
			Enabled: true,
			Directives: []model.Node{
				{Type: model.NodeTypeDirective, Name: "proxy_pass", Args: []string{req.Destination}, Enabled: true},
				{Type: model.NodeTypeDirective, Name: "proxy_set_header", Args: []string{"Host", "$host"}, Enabled: true},
				{Type: model.NodeTypeDirective, Name: "proxy_set_header", Args: []string{"X-Real-IP", "$remote_addr"}, Enabled: true},
			},
		}
		if req.Websockets {
			loc.Directives = append(loc.Directives,
				model.Node{Type: model.NodeTypeDirective, Name: "proxy_set_header", Args: []string{"Upgrade", "$http_upgrade"}, Enabled: true},
				model.Node{Type: model.NodeTypeDirective, Name: "proxy_set_header", Args: []string{"Connection", "\"upgrade\""}, Enabled: true},
			)
		}
		server.Directives = append(server.Directives, loc)
	}
	server.EnsureID()
	return server
}
