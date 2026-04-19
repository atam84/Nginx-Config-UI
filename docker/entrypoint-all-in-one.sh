#!/bin/sh
# All-in-one container entrypoint. Starts nginx as a daemon, then runs the
# admin app in the foreground. The admin manages its sibling nginx via
# `nginx -s reload` and `pgrep nginx` (see NGINX_RELOAD_MODE=signal).
#
# Runs under tini (see Dockerfile ENTRYPOINT) so we don't need to reap
# zombies ourselves. The trap on EXIT tells nginx to quit gracefully on
# container shutdown.

set -eu

: "${NGINX_CONFIG_ROOT:=/etc/nginx}"
export NGINX_CONFIG_ROOT

# Validate config up front — failing fast with a clear message is much nicer
# than letting nginx crash-loop inside the container.
if ! nginx -t; then
  echo "nginx -t failed — refusing to start. Fix /etc/nginx or mount a valid config." >&2
  exit 1
fi

# Daemonize nginx (its own master-worker model; writes /var/run/nginx.pid so
# the admin can signal it later via `nginx -s reload`).
nginx

cleanup() {
  nginx -s quit 2>/dev/null || true
}
trap cleanup TERM INT EXIT

# Admin app in foreground. When it exits (normally or via signal) the trap
# runs and nginx is asked to quit gracefully.
/app/nginx-config-ui
