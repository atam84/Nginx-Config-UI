package serializer

import (
	"strings"

	"github.com/xenos/nginx-config-ui/internal/model"
)

const indentSpaces = 4

// Serialize converts a ConfigFile to Nginx configuration text.
func Serialize(cfg *model.ConfigFile) string {
	var sb strings.Builder
	for _, node := range cfg.Directives {
		sb.WriteString(serializeNode(&node, 0))
	}
	return sb.String()
}

// serializeNode converts a Node to Nginx text. Handles both directives and blocks.
func serializeNode(n *model.Node, level int) string {
	indent := strings.Repeat(" ", level*indentSpaces)
	var sb strings.Builder

	// Blank lines before this node (formatting preservation)
	for i := 0; i < n.BlankLinesBefore; i++ {
		sb.WriteString("\n")
	}

	// Block comment above the directive/block
	if n.Comment != "" {
		for _, line := range strings.Split(n.Comment, "\n") {
			sb.WriteString(indent + "# " + strings.TrimPrefix(line, "# ") + "\n")
		}
	}

	// Disabled: prefix with #
	prefix := ""
	if !n.Enabled {
		prefix = "# "
	}

	args := strings.TrimSpace(strings.Join(n.Args, " "))
	argsPart := ""
	if args != "" {
		argsPart = " " + args
	}

	// Leaf directive: single line ending with ;
	if n.Type == model.NodeTypeDirective || len(n.Directives) == 0 {
		sb.WriteString(indent + prefix + n.Name + argsPart + ";\n")
		return sb.String()
	}

	// Block: has children
	sb.WriteString(indent + prefix + n.Name + argsPart + " {\n")
	for _, child := range n.Directives {
		sb.WriteString(serializeNode(&child, level+1))
	}
	sb.WriteString(indent + "}\n")
	return sb.String()
}
