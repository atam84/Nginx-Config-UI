package api

import (
	"github.com/xenos/nginx-config-ui/internal/model"
)

// AddLocationRequest is the payload for adding a location block.
type AddLocationRequest struct {
	FilePath     string   `json:"file_path"`
	ServerIndex  int      `json:"server_index"`  // index of server block in http
	Path         string   `json:"path"`          // e.g. "/api"
	MatchType    string   `json:"match_type"`    // "", "=", "^~", "~", "~*"
	ProxyPass    string   `json:"proxy_pass"`    // e.g. "http://backend"
	ProxyHeaders []string `json:"proxy_headers"` // optional key-value pairs
}

// CreateLocationBlock builds a location block from the request.
func CreateLocationBlock(req *AddLocationRequest) model.Node {
	args := []string{}
	if req.MatchType != "" {
		args = append(args, req.MatchType)
	}
	args = append(args, req.Path)
	if req.Path == "" {
		args = []string{"/"}
	}

	loc := model.Node{
		Type:    model.NodeTypeBlock,
		Name:    "location",
		Args:    args,
		Enabled: true,
		Directives: []model.Node{
			{Type: model.NodeTypeDirective, Name: "proxy_pass", Args: []string{req.ProxyPass}, Enabled: true},
			{Type: model.NodeTypeDirective, Name: "proxy_set_header", Args: []string{"Host", "$host"}, Enabled: true},
			{Type: model.NodeTypeDirective, Name: "proxy_set_header", Args: []string{"X-Real-IP", "$remote_addr"}, Enabled: true},
		},
	}
	loc.EnsureID()
	return loc
}

// AddLocationToLocationRequest is the payload for adding a nested location by parent ID.
type AddLocationToLocationRequest struct {
	FilePath     string `json:"file_path"`
	ParentLocID  string `json:"parent_location_id"`
	Path         string `json:"path"`
	MatchType    string `json:"match_type"`
	ProxyPass    string `json:"proxy_pass"`
}

// AddLocationToLocation finds a location node by ID anywhere in the tree
// and appends a child location to it. Returns true if found.
func AddLocationToLocation(cfg *model.ConfigFile, parentID string, location model.Node) bool {
	return addLocInNode(&cfg.Directives, parentID, location)
}

func addLocInNode(nodes *[]model.Node, parentID string, location model.Node) bool {
	for i := range *nodes {
		if (*nodes)[i].ID == parentID && (*nodes)[i].Name == "location" {
			(*nodes)[i].Directives = append((*nodes)[i].Directives, location)
			return true
		}
		if addLocInNode(&(*nodes)[i].Directives, parentID, location) {
			return true
		}
	}
	return false
}

// AddLocationToServer inserts a location block into the server at serverIndex.
func AddLocationToServer(cfg *model.ConfigFile, serverIndex int, location model.Node) bool {
	for i := range cfg.Directives {
		if cfg.Directives[i].Name == "http" && cfg.Directives[i].Type == model.NodeTypeBlock {
			servers := cfg.Directives[i].Directives
			idx := 0
			for j := range servers {
				if servers[j].Name == "server" {
					if idx == serverIndex {
						cfg.Directives[i].Directives[j].Directives = append(
							cfg.Directives[i].Directives[j].Directives, location)
						cfg.EnsureConfigFileIDs()
						return true
					}
					idx++
				}
			}
			return false
		}
	}
	return false
}
