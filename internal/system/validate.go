package system

import (
	"os"
	"strings"
)

// wrapSnippetAsMainConfig wraps snippet content (server blocks, upstreams, etc.) in a minimal
// valid nginx main config so "nginx -t -c" can validate it. conf.d files are snippets.
func wrapSnippetAsMainConfig(content string) string {
	trimmed := strings.TrimSpace(content)
	// Already has events and http at top level — use as-is
	if strings.HasPrefix(trimmed, "events ") || strings.HasPrefix(trimmed, "events{") ||
		strings.HasPrefix(trimmed, "http ") || strings.HasPrefix(trimmed, "http{") ||
		strings.HasPrefix(trimmed, "user ") || strings.HasPrefix(trimmed, "worker_processes") {
		return content
	}
	return "events { worker_connections 1024; }\nhttp {\n" + content + "\n}\n"
}

// ValidateConfigContent writes content to a temp file, runs nginx -t -c, and returns the result.
// Snippet content (server/upstream blocks without events/http) is wrapped in a minimal main config.
func ValidateConfigContent(cfg Config, content string) (TestResult, string) {
	tmpDir := os.TempDir()
	f, err := os.CreateTemp(tmpDir, "nginx-config-ui-validate-")
	if err != nil {
		return TestResult{Success: false, Output: "Failed to create temp file: " + err.Error()}, ""
	}
	path := f.Name()
	wrapped := wrapSnippetAsMainConfig(content)
	if _, err := f.WriteString(wrapped); err != nil {
		f.Close()
		os.Remove(path)
		return TestResult{Success: false, Output: "Failed to write temp file: " + err.Error()}, ""
	}
	if err := f.Close(); err != nil {
		os.Remove(path)
		return TestResult{Success: false, Output: "Failed to close temp file: " + err.Error()}, ""
	}

	result := TestConfigFile(cfg, path)
	os.Remove(path)
	return result, ""
}
