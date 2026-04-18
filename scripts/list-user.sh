#!/usr/bin/env bash
# List the configured auth user for nginx-config-ui (single-user).
# Resolution order for AUTH_* variables:
#   1. current shell environment
#   2. /etc/default/nginx-config-ui
#   3. /etc/sysconfig/nginx-config-ui
set -u

ENV_FILES=(/etc/default/nginx-config-ui /etc/sysconfig/nginx-config-ui)

lookup() {
  local name="$1"
  local val="${!name:-}"
  if [[ -n "$val" ]]; then
    printf '%s' "$val"
    return 0
  fi
  for f in "${ENV_FILES[@]}"; do
    [[ -r "$f" ]] || continue
    val=$(grep -E "^[[:space:]]*(export[[:space:]]+)?${name}=" "$f" | tail -n1 \
          | sed -E "s/^[[:space:]]*(export[[:space:]]+)?${name}=//; s/^[\"']//; s/[\"'][[:space:]]*$//")
    if [[ -n "$val" ]]; then
      printf '%s' "$val"
      return 0
    fi
  done
  return 1
}

USERNAME=$(lookup AUTH_USERNAME || true)
HASH=$(lookup AUTH_PASSWORD_HASH || true)
PLAIN=$(lookup AUTH_PASSWORD || true)
DISABLED=$(lookup AUTH_DISABLED || true)

if [[ -z "$USERNAME" && -z "$HASH" && -z "$PLAIN" && -z "$DISABLED" ]]; then
  echo "No AUTH_* variables configured." >&2
  echo "Expected in shell env or ${ENV_FILES[*]}." >&2
  exit 1
fi

echo "username: ${USERNAME:-<unset>}"
if [[ -n "$HASH" ]]; then
  echo "password: set (AUTH_PASSWORD_HASH, bcrypt)"
elif [[ -n "$PLAIN" ]]; then
  echo "password: set (AUTH_PASSWORD, plain — prefer AUTH_PASSWORD_HASH)"
else
  echo "password: NOT SET"
fi
if [[ "$DISABLED" == "1" || "$DISABLED" == "true" ]]; then
  echo "auth:     DISABLED (AUTH_DISABLED=$DISABLED)"
fi
