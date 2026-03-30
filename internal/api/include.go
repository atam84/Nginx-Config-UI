package api

import (
	"path/filepath"
	"strings"
)

// ResolveInclude resolves an nginx include glob relative to configRoot.
// Returns relative paths (relative to configRoot).
func ResolveInclude(configRoot, glob string) ([]string, error) {
	var pattern string
	if filepath.IsAbs(glob) {
		pattern = glob
	} else {
		pattern = filepath.Join(configRoot, filepath.FromSlash(glob))
	}

	matches, err := filepath.Glob(pattern)
	if err != nil {
		return nil, err
	}

	var result []string
	for _, m := range matches {
		rel, err := filepath.Rel(configRoot, m)
		if err != nil || strings.HasPrefix(rel, "..") {
			result = append(result, m)
		} else {
			result = append(result, rel)
		}
	}
	return result, nil
}
