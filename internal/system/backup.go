package system

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Backup creates a tar.gz of the nginx config directory and returns the file path.
func Backup(cfg Config) (string, error) {
	backupDir := os.Getenv("NGINX_BACKUP_DIR")
	if backupDir == "" {
		backupDir = "/var/backups/nginx"
	}
	// Fallback for non-root: use temp dir
	if _, err := os.Stat(backupDir); os.IsNotExist(err) {
		backupDir = filepath.Join(os.TempDir(), "nginx-backups")
	}
	if err := os.MkdirAll(backupDir, 0755); err != nil {
		return "", fmt.Errorf("create backup dir: %w", err)
	}

	timestamp := time.Now().Format("20060102-150405")
	backupFile := filepath.Join(backupDir, fmt.Sprintf("nginx-backup-%s.tar.gz", timestamp))

	if err := createTarGz(backupFile, cfg.ConfigRoot); err != nil {
		return "", fmt.Errorf("create backup: %w", err)
	}
	return backupFile, nil
}

// createTarGz archives sourceDir into destPath.
func createTarGz(destPath, sourceDir string) error {
	info, err := os.Stat(sourceDir)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("%s is not a directory", sourceDir)
	}

	f, err := os.Create(destPath)
	if err != nil {
		return err
	}
	defer f.Close()

	gw := gzip.NewWriter(f)
	defer gw.Close()

	tw := tar.NewWriter(gw)
	defer tw.Close()

	sourceDir = filepath.Clean(sourceDir)
	return filepath.Walk(sourceDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(sourceDir, path)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		rel = filepath.Join(".", rel)

		header, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		header.Name = rel

		if err := tw.WriteHeader(header); err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		defer file.Close()
		_, err = io.Copy(tw, file)
		return err
	})
}

// RestoreResult holds the outcome of a restore.
type RestoreResult struct {
	Success bool
	Message string
}

// Restore extracts tar.gz content over the config directory, then reloads nginx.
func Restore(cfg Config, tarGzPath string) RestoreResult {
	destDir := cfg.ConfigRoot
	if err := extractTarGz(tarGzPath, destDir); err != nil {
		return RestoreResult{
			Success: false,
			Message: fmt.Sprintf("Extract failed: %v", err),
		}
	}
	reload := Reload(cfg)
	return RestoreResult{
		Success: reload.Success,
		Message: reload.Message,
	}
}

// extractTarGz extracts a .tar.gz file into destDir.
// Paths are sanitized to prevent traversal (e.g. ../../../etc/passwd).
func extractTarGz(tarGzPath, destDir string) error {
	destDir = filepath.Clean(destDir)
	f, err := os.Open(tarGzPath)
	if err != nil {
		return err
	}
	defer f.Close()

	gr, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gr.Close()

	tr := tar.NewReader(gr)
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		name := header.Name
		if strings.Contains(name, "..") {
			continue // skip path traversal attempts
		}
		target := filepath.Join(destDir, name)
		if !strings.HasPrefix(filepath.Clean(target), destDir) {
			continue // skip if outside dest
		}

		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, os.FileMode(header.Mode)|0755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
				return err
			}
			out, err := os.OpenFile(target, os.O_CREATE|os.O_RDWR|os.O_TRUNC, os.FileMode(header.Mode))
			if err != nil {
				return err
			}
			if _, err := io.Copy(out, tr); err != nil {
				out.Close()
				return err
			}
			out.Close()
		}
	}
	return nil
}
