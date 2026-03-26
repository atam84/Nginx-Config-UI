package security

import (
	"path/filepath"
	"strings"
	"unicode"
)

// MaxFilenameLength is the maximum allowed config filename length.
const MaxFilenameLength = 255

// SanitizeConfigFilename validates and sanitizes a config filename.
// Returns empty string if invalid. Prevents path traversal and dangerous characters.
func SanitizeConfigFilename(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}
	// Reject path separators and traversal
	if strings.ContainsAny(name, "/\\") || strings.Contains(name, "..") {
		return ""
	}
	// Reject null bytes and control characters
	for _, r := range name {
		if r == 0 || unicode.IsControl(r) {
			return ""
		}
	}
	// Ensure .conf extension
	if filepath.Ext(name) != ".conf" {
		name = name + ".conf"
	}
	// Reject if too long
	if len(name) > MaxFilenameLength {
		return ""
	}
	// Only allow safe characters: alphanumeric, dash, underscore, dot
	for _, r := range name {
		if !unicode.IsLetter(r) && !unicode.IsNumber(r) && r != '-' && r != '_' && r != '.' {
			return ""
		}
	}
	return name
}
