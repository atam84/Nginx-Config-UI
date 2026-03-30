package api

import (
	"strings"

	"github.com/xenos/nginx-config-ui/internal/model"
	"github.com/xenos/nginx-config-ui/internal/parser"
	"github.com/xenos/nginx-config-ui/internal/paths"
)

// SearchResult represents a matched directive in a config file
type SearchResult struct {
	FilePath   string   `json:"file_path"`
	NodeID     string   `json:"node_id"`
	Directive  string   `json:"directive"`
	Args       []string `json:"args"`
	LineNumber int      `json:"line_number"`
	Context    string   `json:"context"`
}

// SearchConfigs searches all config files for directives matching query
func SearchConfigs(configRoot string, files []ConfigFileInfo, query string) []SearchResult {
	q := strings.ToLower(query)
	var results []SearchResult
	for _, f := range files {
		safePath := paths.SanitizeConfigPath(configRoot, f.Path)
		if safePath == "" {
			continue
		}
		cfg, err := parser.ParseFromFile(safePath)
		if err != nil {
			continue
		}
		walkSearch(&cfg.Directives, f.Path, "", q, &results)
	}
	return results
}

func walkSearch(nodes *[]model.Node, filePath, ctx, q string, results *[]SearchResult) {
	for _, n := range *nodes {
		matched := strings.Contains(strings.ToLower(n.Name), q)
		if !matched {
			for _, a := range n.Args {
				if strings.Contains(strings.ToLower(a), q) {
					matched = true
					break
				}
			}
		}
		if !matched && strings.Contains(strings.ToLower(n.Comment), q) {
			matched = true
		}
		if matched {
			*results = append(*results, SearchResult{
				FilePath:   filePath,
				NodeID:     n.ID,
				Directive:  n.Name,
				Args:       n.Args,
				LineNumber: n.LineNumber,
				Context:    ctx,
			})
		}
		childCtx := ctx
		if n.Name != "" {
			childCtx = ctx + " > " + n.Name
			if len(n.Args) > 0 {
				childCtx += "[" + n.Args[0] + "]"
			}
		}
		walkSearch(&n.Directives, filePath, childCtx, q, results)
	}
}
