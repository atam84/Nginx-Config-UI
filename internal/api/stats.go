package api

import (
	"os"
	"path/filepath"

	"github.com/xenos/nginx-config-ui/internal/model"
	"github.com/xenos/nginx-config-ui/internal/parser"
)

// Stats holds dashboard statistics.
type Stats struct {
	ServerBlocks int `json:"server_blocks"`
	Upstreams    int `json:"upstreams"`
	ConfigFiles  int `json:"config_files"`
}

// GetStats returns counts for server blocks, upstreams, and config files.
// Tolerates missing config files (e.g. in dev) and returns zero counts.
func GetStats(configRoot string) (Stats, error) {
	fileInfos, _ := ListConfigFiles(configRoot)
	stats := Stats{ConfigFiles: len(fileInfos)}

	upstreams, _ := ListUpstreamsFromConfigRoot(configRoot)
	stats.Upstreams = len(upstreams)

	// Count server blocks
	mainConf := filepath.Join(configRoot, "nginx.conf")
	if cfg, err := parser.ParseFromFile(mainConf); err == nil {
		stats.ServerBlocks += countServerBlocks(&cfg.Directives)
	}
	confd := filepath.Join(configRoot, "conf.d")
	matches, _ := filepath.Glob(filepath.Join(confd, "*.conf"))
	for _, path := range matches {
		if cfg, err := parser.ParseFromFile(path); err == nil {
			stats.ServerBlocks += countServerBlocks(&cfg.Directives)
		}
	}
	// sites-enabled (symlinks to sites-available; nginx includes only these)
	sitesEnabled := filepath.Join(configRoot, "sites-enabled")
	if entries, err := os.ReadDir(sitesEnabled); err == nil {
		for _, e := range entries {
			if !e.IsDir() {
				path := filepath.Join(sitesEnabled, e.Name())
				if cfg, err := parser.ParseFromFile(path); err == nil {
					stats.ServerBlocks += countServerBlocks(&cfg.Directives)
				}
			}
		}
	}

	return stats, nil
}

func countServerBlocks(directives *[]model.Node) int {
	n := 0
	for i := range *directives {
		countInNode(&(*directives)[i], &n)
	}
	return n
}

func countInNode(node *model.Node, n *int) {
	if node == nil {
		return
	}
	if node.Name == "server" && node.Enabled {
		*n++
	}
	for i := range node.Directives {
		countInNode(&node.Directives[i], n)
	}
}

