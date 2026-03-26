package parser

import (
	"fmt"
	"os"
	"strings"

	"github.com/tufanbarisyildirim/gonginx/config"
	"github.com/tufanbarisyildirim/gonginx/parser"
	"github.com/xenos/nginx-config-ui/internal/model"
)

// ParseFromString parses Nginx configuration from a string and returns our JSON AST model.
func ParseFromString(content string, filePath string) (*model.ConfigFile, error) {
	p := parser.NewStringParser(content, parser.WithSkipValidDirectivesErr())
	c, err := p.Parse()
	if err != nil {
		return nil, fmt.Errorf("parse error: %w", err)
	}
	return convertConfig(c, filePath)
}

// ParseFromFile parses an Nginx configuration file and returns our JSON AST model.
func ParseFromFile(path string) (*model.ConfigFile, error) {
	p, err := parser.NewParser(path, parser.WithSkipValidDirectivesErr())
	if err != nil {
		return nil, fmt.Errorf("open file: %w", err)
	}
	defer p.Close()

	c, err := p.Parse()
	if err != nil {
		return nil, fmt.Errorf("parse error: %w", err)
	}
	return convertConfig(c, path)
}

// convertConfig maps gonginx config.Config to our model.ConfigFile.
func convertConfig(c *config.Config, filePath string) (*model.ConfigFile, error) {
	cfg := &model.ConfigFile{
		FilePath:   filePath,
		Status:     "enabled",
		Directives: convertDirectives(c.Block.GetDirectives()),
	}
	cfg.EnsureConfigFileIDs()
	return cfg, nil
}

// convertDirectives converts a slice of gonginx IDirective to our model nodes.
func convertDirectives(dirs []config.IDirective) []model.Node {
	nodes := make([]model.Node, 0, len(dirs))
	for _, d := range dirs {
		if d == nil {
			continue
		}
		nodes = append(nodes, convertDirective(d))
	}
	return nodes
}

// convertDirective maps a single gonginx IDirective to our model.Node.
func convertDirective(d config.IDirective) model.Node {
	args := parametersToArgs(d.GetParameters())
	comment := strings.Join(d.GetComment(), "\n")
	if ic := getInlineComment(d); ic != "" {
		if comment != "" {
			comment += " " + ic
		} else {
			comment = ic
		}
	}

	n := model.Node{
		Name:       d.GetName(),
		Args:       args,
		Comment:    strings.TrimSpace(comment),
		LineNumber: d.GetLine(),
		Enabled:    true, // gonginx does not parse commented-out directives; they appear as comments
	}

	block := d.GetBlock()
	if block != nil && len(block.GetDirectives()) > 0 {
		n.Type = model.NodeTypeBlock
		n.Directives = convertDirectives(block.GetDirectives())
	} else {
		n.Type = model.NodeTypeDirective
	}

	n.EnsureID()
	return n
}

func parametersToArgs(params []config.Parameter) []string {
	args := make([]string, 0, len(params))
	for _, p := range params {
		if v := strings.TrimSpace(p.GetValue()); v != "" {
			args = append(args, v)
		}
	}
	return args
}

// getInlineComment extracts inline comment from a directive if it implements InlineCommenter.
func getInlineComment(d config.IDirective) string {
	type inlineCommenter interface {
		GetInlineComment() []config.InlineComment
	}
	if ic, ok := d.(inlineCommenter); ok {
		comments := ic.GetInlineComment()
		if len(comments) == 0 {
			return ""
		}
		parts := make([]string, 0, len(comments))
		for _, c := range comments {
			// InlineComment has same structure as Parameter; convert and get value
			p := config.Parameter(c)
			v := strings.TrimSpace((&p).GetValue())
			if v != "" {
				parts = append(parts, v)
			}
		}
		return strings.Join(parts, " ")
	}
	return ""
}

// ReadFileContent reads a file and returns its contents. Used for API when path is provided.
func ReadFileContent(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(b), nil
}
