#!/usr/bin/env bash
# Reset the single-user password by generating a new bcrypt hash.
# Usage: ./scripts/reset-password.sh [username]
#   - Prompts twice for the new password (silent input).
#   - Prints AUTH_USERNAME / AUTH_PASSWORD_HASH lines to paste into
#     /etc/default/nginx-config-ui (or your systemd Environment= block).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

USERNAME="${1:-${AUTH_USERNAME:-}}"
if [[ -z "$USERNAME" ]]; then
  read -rp "Username: " USERNAME
fi
if [[ -z "$USERNAME" ]]; then
  echo "username required" >&2
  exit 1
fi

read -rsp "New password: " PW1; echo
read -rsp "Confirm:      " PW2; echo
if [[ "$PW1" != "$PW2" ]]; then
  echo "passwords do not match" >&2
  exit 1
fi
if [[ -z "$PW1" ]]; then
  echo "empty password" >&2
  exit 1
fi

cd "$REPO_ROOT"
HASH=$(printf '%s\n' "$PW1" | go run ./cmd/hashpw)
unset PW1 PW2

cat <<EOF

Password hash generated. Update your service environment with:

AUTH_USERNAME=$USERNAME
AUTH_PASSWORD_HASH='$HASH'

Typical locations:
  /etc/default/nginx-config-ui       (Debian/Ubuntu)
  /etc/sysconfig/nginx-config-ui     (RHEL/Fedora)
  systemd unit: Environment= lines, then 'systemctl daemon-reload'

After updating, restart the service (e.g. 'systemctl restart nginx-config-ui').
EOF
