# Security

## Authentication

The UI supports optional JWT authentication. Set these environment variables:

- `AUTH_DISABLED=1` — Disable auth (development only)
- `AUTH_USERNAME` — Login username
- `AUTH_PASSWORD` — Plain password (hashed at startup; use `AUTH_PASSWORD_HASH` in production)
- `AUTH_PASSWORD_HASH` — Bcrypt hash (recommended). Generate with:
  ```go
  // go run -e 'package main; import ("fmt"; "golang.org/x/crypto/bcrypt"); func main() { h, _ := bcrypt.GenerateFromPassword([]byte("yourpassword"), bcrypt.DefaultCost); fmt.Println(string(h)) }'
  ```
  Or use: `htpasswd -nbBC 10 "" yourpassword | tr -d ':\n'`
- `JWT_SECRET` — Secret for signing tokens (default: insecure placeholder)

## Input Sanitization

- **Command injection**: All system commands (`nginx -t`, `systemctl`) use `exec.Command` with separate arguments. No shell is invoked; user input is never passed to a shell.
- **Path traversal**: Config paths are sanitized via `SanitizeConfigPath`. Only paths under the config root are allowed.
- **Filename sanitization**: New config filenames are validated (alphanumeric, dash, underscore, `.conf` only).

## Config Validation

Before saving, the backend validates:

- **IP addresses**: Upstream server addresses must be valid IPv4, IPv6, or hostnames.
- **Ports**: Listen and server ports must be 1–65535.

## Privilege Separation (13.5)

Run the backend with minimal privileges:

- Do not run as root. Use a dedicated user (e.g. `nginx-ui`).
- Grant sudo only for `systemctl reload nginx` and `nginx -t` if needed.
- Alternatively, run the backend as the same user that owns `/etc/nginx` and can reload nginx.
- Consider a reverse proxy (nginx, Caddy) in front of the UI with TLS.

## Fail2Ban (13.6)

If the UI is exposed publicly, use Fail2Ban to limit brute-force on login:

```ini
# /etc/fail2ban/jail.d/nginx-ui.conf
[nginx-ui]
enabled = true
port = http,https
filter = nginx-ui
logpath = /var/log/nginx-ui/access.log
maxretry = 5
bantime = 3600
```

Create `/etc/fail2ban/filter.d/nginx-ui.conf`:

```ini
[Definition]
failregex = ^<HOST> .* "POST /api/auth/login HTTP.*" 401
ignoreregex =
```

Ensure the application logs failed login attempts with client IP.
