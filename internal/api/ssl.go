package api

import (
	"bytes"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// CertInfo describes a Let's Encrypt certificate managed by certbot.
type CertInfo struct {
	// Name is the certificate name (usually the primary domain).
	Name string `json:"name"`
	// Domains lists all SANs on the certificate.
	Domains []string `json:"domains"`
	// CertPath is the path to fullchain.pem.
	CertPath string `json:"cert_path"`
	// KeyPath is the path to privkey.pem.
	KeyPath string `json:"key_path"`
	// ExpiresAt is the certificate expiry time in RFC3339 format.
	ExpiresAt string `json:"expires_at,omitempty"`
	// DaysLeft is the number of days until expiry.
	DaysLeft int `json:"days_left"`
	// Status is "valid", "expiring_soon" (<30 days), or "expired".
	Status string `json:"status"`
}

// letsencryptLiveDir is the default certbot live directory.
const letsencryptLiveDir = "/etc/letsencrypt/live"

// ListCertificates scans /etc/letsencrypt/live/ and returns certificate metadata.
func ListCertificates() ([]CertInfo, error) {
	entries, err := os.ReadDir(letsencryptLiveDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []CertInfo{}, nil
		}
		return nil, fmt.Errorf("read %s: %w", letsencryptLiveDir, err)
	}

	var certs []CertInfo
	for _, e := range entries {
		if !e.IsDir() || e.Name() == "README" {
			continue
		}
		certPath := filepath.Join(letsencryptLiveDir, e.Name(), "fullchain.pem")
		keyPath := filepath.Join(letsencryptLiveDir, e.Name(), "privkey.pem")

		info := CertInfo{
			Name:     e.Name(),
			CertPath: certPath,
			KeyPath:  keyPath,
			Status:   "unknown",
		}

		// Parse certificate to get domains and expiry
		if data, err := os.ReadFile(certPath); err == nil {
			if cert, err := parseCertPEM(data); err == nil {
				info.Domains = buildDomainList(cert)
				info.ExpiresAt = cert.NotAfter.Format(time.RFC3339)
				info.DaysLeft = int(time.Until(cert.NotAfter).Hours() / 24)
				switch {
				case info.DaysLeft < 0:
					info.Status = "expired"
				case info.DaysLeft < 30:
					info.Status = "expiring_soon"
				default:
					info.Status = "valid"
				}
			}
		}

		certs = append(certs, info)
	}
	return certs, nil
}

// RequestCertificate runs certbot to obtain a certificate for the given domains.
// If webroot is non-empty, the HTTP-01 webroot plugin is used; otherwise standalone.
func RequestCertificate(domains []string, email, webroot string) (string, error) {
	if len(domains) == 0 {
		return "", fmt.Errorf("at least one domain is required")
	}

	args := []string{"certonly", "--non-interactive", "--agree-tos"}
	if email != "" {
		args = append(args, "--email", email)
	} else {
		args = append(args, "--register-unsafely-without-email")
	}

	if webroot != "" {
		args = append(args, "--webroot", "--webroot-path", webroot)
	} else {
		args = append(args, "--standalone")
	}

	for _, d := range domains {
		d = strings.TrimSpace(d)
		if d != "" {
			args = append(args, "-d", d)
		}
	}

	var out bytes.Buffer
	cmd := exec.Command("certbot", args...)
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		return out.String(), fmt.Errorf("certbot failed: %s", out.String())
	}
	return out.String(), nil
}

// RenewCertificate runs certbot renew for a specific certificate name (or all if empty).
func RenewCertificate(certName string) (string, error) {
	args := []string{"renew", "--non-interactive"}
	if certName != "" {
		args = append(args, "--cert-name", certName)
	}
	var out bytes.Buffer
	cmd := exec.Command("certbot", args...)
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		return out.String(), fmt.Errorf("certbot renew failed: %s", out.String())
	}
	return out.String(), nil
}

// parseCertPEM decodes the first PEM CERTIFICATE block and parses it.
func parseCertPEM(data []byte) (*x509.Certificate, error) {
	for {
		var block *pem.Block
		block, data = pem.Decode(data)
		if block == nil {
			break
		}
		if block.Type != "CERTIFICATE" {
			continue
		}
		return x509.ParseCertificate(block.Bytes)
	}
	return nil, fmt.Errorf("no certificate found in PEM data")
}

// buildDomainList extracts unique domains from a certificate (CN + SANs).
func buildDomainList(cert *x509.Certificate) []string {
	seen := map[string]bool{}
	var out []string
	for _, d := range append([]string{cert.Subject.CommonName}, cert.DNSNames...) {
		if d != "" && !seen[d] {
			seen[d] = true
			out = append(out, d)
		}
	}
	return out
}
