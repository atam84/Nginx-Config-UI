package api

import (
	"os"
	"path/filepath"

	"github.com/xenos/nginx-config-ui/internal/model"
	"github.com/xenos/nginx-config-ui/internal/parser"
)

// UpstreamInfo represents an upstream block for dropdowns.
type UpstreamInfo struct {
	Name   string `json:"name"`
	File   string `json:"file"`
	Servers []string `json:"servers,omitempty"`
}

// FindUpstreams walks the node tree and collects upstream blocks.
func FindUpstreams(node *model.Node) []UpstreamInfo {
	var result []UpstreamInfo
	findUpstreamsInNode(node, "", &result)
	return result
}

func findUpstreamsInNode(node *model.Node, file string, out *[]UpstreamInfo) {
	if node == nil {
		return
	}
	if node.Name == "upstream" && len(node.Args) > 0 {
		info := UpstreamInfo{
			Name:   node.Args[0],
			File:   file,
			Servers: []string{},
		}
		for _, child := range node.Directives {
			if child.Name == "server" && len(child.Args) > 0 {
				info.Servers = append(info.Servers, child.Args[0])
			}
		}
		*out = append(*out, info)
	}
	for i := range node.Directives {
		findUpstreamsInNode(&node.Directives[i], file, out)
	}
}

// ListUpstreamsFromConfigRoot parses config files under root and returns all upstreams.
func ListUpstreamsFromConfigRoot(configRoot string) ([]UpstreamInfo, error) {
	mainConf := filepath.Join(configRoot, "nginx.conf")
	cfg, err := parser.ParseFromFile(mainConf)
	if err != nil {
		return nil, err
	}
	var result []UpstreamInfo
	for _, d := range cfg.Directives {
		findUpstreamsInNode(&d, mainConf, &result)
	}
	// Also check conf.d
	confd := filepath.Join(configRoot, "conf.d")
	matches, _ := filepath.Glob(filepath.Join(confd, "*.conf"))
	for _, path := range matches {
		if c, err := parser.ParseFromFile(path); err == nil {
			for _, d := range c.Directives {
				findUpstreamsInNode(&d, path, &result)
			}
		}
	}
	// Check sites-enabled if it exists
	sitesEnabled := filepath.Join(configRoot, "sites-enabled")
	if _, err := os.Stat(sitesEnabled); err == nil {
		matches, _ := filepath.Glob(filepath.Join(sitesEnabled, "*"))
		for _, path := range matches {
			if info, _ := os.Stat(path); info != nil && !info.IsDir() {
				if c, err := parser.ParseFromFile(path); err == nil {
					for _, d := range c.Directives {
						findUpstreamsInNode(&d, path, &result)
					}
				}
			}
		}
	}
	return result, nil
}
