package model

import "github.com/google/uuid"

// IsDirective returns true if the node is a leaf directive.
func (n *Node) IsDirective() bool {
	return n.Type == NodeTypeDirective
}

// IsBlock returns true if the node is a container block.
func (n *Node) IsBlock() bool {
	return n.Type == NodeTypeBlock
}

// EnsureID sets the node's ID to a new UUID if it's empty.
func (n *Node) EnsureID() {
	if n.ID == "" {
		n.ID = uuid.New().String()
	}
}

// EnsureIDs recursively ensures all nodes in the tree have IDs.
func (n *Node) EnsureIDs() {
	n.EnsureID()
	for i := range n.Directives {
		n.Directives[i].EnsureIDs()
	}
}

// EnsureConfigFileIDs walks all top-level directives and ensures they have IDs.
func (c *ConfigFile) EnsureConfigFileIDs() {
	for i := range c.Directives {
		c.Directives[i].EnsureIDs()
	}
}
