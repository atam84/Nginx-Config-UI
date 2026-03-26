package paths

import (
	"path/filepath"
	"strings"
)

// SanitizeConfigPath returns a safe absolute path under root, or empty string if invalid.
// Prevents path traversal (e.g., ../../etc/passwd).
func SanitizeConfigPath(root, name string) string {
	if root == "" || name == "" {
		return ""
	}
	// Clean and join
	root = filepath.Clean(root)
	full := filepath.Join(root, filepath.Clean(name))
	// Ensure result is under root
	rel, err := filepath.Rel(root, full)
	if err != nil || strings.HasPrefix(rel, "..") || rel == ".." {
		return ""
	}
	return full
}
