package security

import (
	"net"
	"regexp"
	"strconv"
	"strings"

	"github.com/xenos/nginx-config-ui/internal/model"
)

// ValidateIP checks if s is a valid IPv4, IPv6, or hostname.
func ValidateIP(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return false
	}
	// IPv4 or hostname
	if ip := net.ParseIP(s); ip != nil {
		return true
	}
	// host:port format (e.g. 127.0.0.1:8080)
	if host, _, err := net.SplitHostPort(s); err == nil {
		return ValidateIP(host)
	}
	// Hostname: alphanumeric, dots, hyphens
	if len(s) > 253 {
		return false
	}
	hostnameRe := regexp.MustCompile(`^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$`)
	return hostnameRe.MatchString(s)
}

// ValidatePort checks if s is a valid port number (1-65535).
func ValidatePort(s string) bool {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil {
		return false
	}
	return n >= 1 && n <= 65535
}

// ValidateServerAddress validates upstream server arg (e.g. "10.0.0.1:8080", "unix:/tmp/sock").
func ValidateServerAddress(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return false
	}
	if strings.HasPrefix(s, "unix:") {
		// Unix socket path - allow alphanumeric, /, -, _, .
		return len(s) < 256 && !strings.Contains(s, "..")
	}
	host, port, err := net.SplitHostPort(s)
	if err != nil {
		// No port - just host
		return ValidateIP(s)
	}
	return ValidateIP(host) && ValidatePort(port)
}

// ValidateListenPort extracts port from listen args and validates.
func ValidateListenPort(args []string) bool {
	if len(args) == 0 {
		return false
	}
	parts := strings.Fields(strings.Join(args, " "))
	port := parts[0]
	return ValidatePort(port)
}

// ConfigValidationError describes a validation failure.
type ConfigValidationError struct {
	Message string
	Node    string
}

func (e *ConfigValidationError) Error() string {
	return e.Message
}

// ValidateConfig walks the config AST and validates IPs, ports, server addresses.
func ValidateConfig(cfg *model.ConfigFile) error {
	return validateNodes(cfg.Directives, "")
}

func validateNodes(nodes []model.Node, context string) error {
	for _, n := range nodes {
		ctx := context
		if ctx == "" {
			ctx = n.Name
		} else {
			ctx = ctx + " > " + n.Name
		}
		if n.Name == "server" && len(n.Args) > 0 {
			// Upstream server directive
			addr := n.Args[0]
			if !ValidateServerAddress(addr) {
				return &ConfigValidationError{
					Message: "invalid server address: " + addr,
					Node:    ctx,
				}
			}
		}
		if n.Name == "listen" && len(n.Args) > 0 {
			if !ValidateListenPort(n.Args) {
				return &ConfigValidationError{
					Message: "invalid listen port: " + strings.Join(n.Args, " "),
					Node:    ctx,
				}
			}
		}
		if len(n.Directives) > 0 {
			if err := validateNodes(n.Directives, ctx); err != nil {
				return err
			}
		}
	}
	return nil
}
