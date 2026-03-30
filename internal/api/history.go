package api

import (
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/xenos/nginx-config-ui/internal/paths"
)

// HistoryEntry represents one saved version
type HistoryEntry struct {
	Timestamp int64 `json:"ts"`
	Size      int64 `json:"size"`
}

// historyDir returns the history directory for a config file
func historyDir(configRoot, relPath string) string {
	return filepath.Join(configRoot, ".history", filepath.FromSlash(relPath))
}

// SaveHistory writes the current file content as a history entry before overwriting
func SaveHistory(configRoot, relPath string) error {
	safePath := paths.SanitizeConfigPath(configRoot, relPath)
	if safePath == "" {
		return nil
	}
	data, err := os.ReadFile(safePath)
	if err != nil {
		return nil // file doesn't exist yet, no history to save
	}
	dir := historyDir(configRoot, relPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	ts := strconv.FormatInt(time.Now().UnixMilli(), 10)
	bakPath := filepath.Join(dir, ts+".bak")
	return os.WriteFile(bakPath, data, 0644)
}

// ListHistory returns all history entries for a config file, newest first
func ListHistory(configRoot, relPath string) ([]HistoryEntry, error) {
	dir := historyDir(configRoot, relPath)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []HistoryEntry{}, nil
		}
		return nil, err
	}
	var result []HistoryEntry
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".bak") {
			continue
		}
		tsStr := strings.TrimSuffix(e.Name(), ".bak")
		ts, err := strconv.ParseInt(tsStr, 10, 64)
		if err != nil {
			continue
		}
		info, _ := e.Info()
		size := int64(0)
		if info != nil {
			size = info.Size()
		}
		result = append(result, HistoryEntry{Timestamp: ts, Size: size})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Timestamp > result[j].Timestamp })
	return result, nil
}

// GetHistoryVersion returns the content of a specific version
func GetHistoryVersion(configRoot, relPath string, ts int64) ([]byte, error) {
	dir := historyDir(configRoot, relPath)
	bakPath := filepath.Join(dir, strconv.FormatInt(ts, 10)+".bak")
	return os.ReadFile(bakPath)
}
