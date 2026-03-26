package system

import (
	"os"
	"path/filepath"
	"testing"
)

func TestBackup_Restore_Roundtrip(t *testing.T) {
	// Use temp dir as config root for test
	tmpRoot := t.TempDir()
	cfg := Config{
		NginxBin:     "nginx",
		NginxService: "nginx",
		ConfigRoot:   tmpRoot,
		SystemctlBin: "systemctl",
	}

	// Create a dummy config file
	testConf := filepath.Join(tmpRoot, "test.conf")
	if err := os.WriteFile(testConf, []byte("worker_processes 1;\nevents { worker_connections 1024; }\n"), 0644); err != nil {
		t.Fatalf("write test config: %v", err)
	}

	// Backup
	os.Setenv("NGINX_BACKUP_DIR", t.TempDir())
	defer os.Unsetenv("NGINX_BACKUP_DIR")

	path, err := Backup(cfg)
	if err != nil {
		t.Fatalf("Backup failed: %v", err)
	}
	if path == "" {
		t.Error("Backup returned empty path")
	}
	if _, err := os.Stat(path); err != nil {
		t.Errorf("Backup file not found: %v", err)
	}

	// Restore to a new dir (don't overwrite our test dir with reload)
	restoreDir := t.TempDir()
	restoreCfg := Config{
		NginxBin:     cfg.NginxBin,
		NginxService: cfg.NginxService,
		ConfigRoot:   restoreDir,
		SystemctlBin: cfg.SystemctlBin,
	}
	result := Restore(restoreCfg, path)
	// Restore may fail reload if nginx not running - but extract should work
	if !result.Success && !filepath.IsAbs(path) {
		t.Logf("Restore message: %s", result.Message)
	}

	// Verify extracted content
	restoredConf := filepath.Join(restoreDir, "test.conf")
	if _, err := os.Stat(restoredConf); err != nil {
		t.Errorf("Restored config not found: %v", err)
	}
}
