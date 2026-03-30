package model

// NodeType distinguishes between a single directive and a block.
const (
	NodeTypeDirective = "directive"
	NodeTypeBlock     = "block"
)

// Node represents a single Nginx configuration element in the Universal Node structure.
// A node is either a directive (leaf, ends with `;`) or a block (container, has children).
// This structure bridges Nginx's text format and the Web UI.
type Node struct {
	// ID uniquely identifies the node for UI state tracking (UUID recommended).
	ID string `json:"id"`
	// Type is "directive" (single line ending in `;`) or "block" (multi-line ending in `{}`).
	Type string `json:"type"`
	// Name is the Nginx directive name (e.g., "worker_processes", "upstream", "server").
	Name string `json:"name"`
	// Args are the space-separated arguments (e.g., ["auto"], ["80"], ["my_backend"]).
	Args []string `json:"args"`
	// Comment holds any comment associated with this directive/block.
	Comment string `json:"comment,omitempty"`
	// LineNumber is the 1-based line number in the original config file (optional).
	LineNumber int `json:"line_number,omitempty"`
	// Enabled controls whether the line is active. If false, serialization prefixes with `#`.
	Enabled bool `json:"enabled"`
	// BlankLinesBefore is the number of blank lines before this node in the original file.
	// Used by the serializer to preserve original formatting. Zero means no extra spacing.
	BlankLinesBefore int `json:"blank_lines_before,omitempty"`
	// Directives contains child nodes. Only populated when Type is "block".
	Directives []Node `json:"directives,omitempty"`
}

// Directive represents a leaf node (single line ending in `;`).
// Use Node with Type="directive" for the unified model.
type Directive struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Args       []string `json:"args"`
	Comment    string   `json:"comment,omitempty"`
	LineNumber int      `json:"line_number,omitempty"`
	Enabled    bool     `json:"enabled"`
}

// Block represents a container node (directive with `{}` containing child directives/blocks).
type Block struct {
	Directive
	Directives []Node `json:"directives"` // Can be directive or block nodes
}

// ConfigFile represents a full Nginx configuration file in the JSON AST format.
// This is the contract between the Frontend and Backend.
type ConfigFile struct {
	// FilePath is the absolute or relative path (e.g., "/etc/nginx/conf.d/default.conf").
	FilePath string `json:"file_path"`
	// Status indicates if the file is enabled or disabled at the file level.
	Status string `json:"status"` // "enabled" or "disabled"
	// Directives are the top-level nodes (e.g., worker_processes, events, http).
	Directives []Node `json:"directives"`
}
