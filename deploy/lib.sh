#!/usr/bin/env bash
# shellcheck disable=SC2034  # constants for the scripts that source this file
# Shared by deploy/server-install.sh and deploy/server-update.sh (sourced, never run directly).
# The server layout is fixed: see deploy/README.md.
set -euo pipefail

TTK_USER=ttk
TTK_HOME=/opt/ttk
APP_DIR=$TTK_HOME/app
VENV=$TTK_HOME/venv
WEB_ROOT=$TTK_HOME/web
RELEASES=$WEB_ROOT/releases
CURRENT=$WEB_ROOT/current
KEEP_RELEASES=3
ETC_DIR=/etc/ttk
APP_ENV_FILE=$ETC_DIR/app.env
DB_ENV_FILE=$ETC_DIR/db.env
DATA_DIR=/var/lib/ttk
UPLOADS=$DATA_DIR/uploads
PYTHON_BIN=python3.12
CADDY_CA=/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt
# The order matters: payroll's tables reference admin's, attendance's reference payroll's.
MIGRATION_SECTIONS=(core admin payroll attendance)
SAFE_PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

step() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
warn() { printf '\033[1;33mWARNING: %s\033[0m\n' "$*" >&2; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

require_root() {
  [ "$(id -u)" -eq 0 ] || die "run it with sudo: sudo bash $0"
}

# Only one deploy at a time (install, update and rollback share the lock).
take_lock() {
  exec 9>/run/lock/ttk-deploy.lock
  flock -n 9 || die "another TTK install/update is running"
}

# Run a command as the ttk user with a clean environment (HOME=/opt/ttk for npm/pip/ssh).
as_ttk() {
  runuser -u "$TTK_USER" -- env -i HOME="$TTK_HOME" PATH="$SAFE_PATH" LANG=C.UTF-8 "$@"
}

# The same, with /etc/ttk/app.env loaded (what the API sees under systemd), from the code folder.
as_ttk_env() {
  # shellcheck disable=SC2016  # expanded by the inner bash
  as_ttk bash -c 'set -a; . "$0"; set +a; cd "$1"; shift; exec "$@"' "$APP_ENV_FILE" "$APP_DIR" "$@"
}

# KEY's value from an env file (plain KEY=value lines), without sourcing it into this shell.
env_value() {
  sed -n "s/^$2=//p" "$1" | tail -n 1
}

install_python_deps() {
  if [ -x "$VENV/bin/python" ] && ! "$VENV/bin/python" -c 'import sys; assert sys.version_info[:2] == (3, 12)' 2>/dev/null; then
    note "the venv is not Python 3.12: recreating it"
    rm -rf "$VENV"
  fi
  install -d -o "$TTK_USER" -g "$TTK_USER" -m 755 "$VENV"
  if [ ! -x "$VENV/bin/python" ]; then
    as_ttk "$PYTHON_BIN" -m venv "$VENV"
  fi
  as_ttk "$VENV/bin/python" -m pip install --quiet --upgrade pip
  as_ttk "$VENV/bin/python" -m pip install --quiet --requirement "$APP_DIR/requirements.txt"
  note "Python deps installed in $VENV"
}

run_migrations() {
  local section
  for section in "${MIGRATION_SECTIONS[@]}"; do
    note "alembic -n $section upgrade head"
    as_ttk_env "$VENV/bin/python" -m alembic -n "$section" upgrade head
  done
}

# Build the web app in the checkout and copy it into a new release folder. Prints the folder on
# the last line of stdout; the running site (current) is not touched.
build_release() {
  local stamp dir
  stamp="$(date +%Y%m%d-%H%M%S)"
  dir="$RELEASES/$stamp"
  install -d -o "$TTK_USER" -g "$TTK_USER" -m 755 "$WEB_ROOT" "$RELEASES"
  # shellcheck disable=SC2016  # expanded by the inner bash
  as_ttk bash -c '
    set -euo pipefail
    cd "$0/web"
    npm ci --no-audit --no-fund --loglevel=error
    NODE_OPTIONS=--max-old-space-size=1536 NEXT_TELEMETRY_DISABLED=1 npm run build
    [ -f .next/standalone/server.js ] || { echo "no .next/standalone/server.js: is output: \"standalone\" set?" >&2; exit 1; }
    mkdir "$1"
    cp -a .next/standalone/. "$1/"
    mkdir -p "$1/.next"
    cp -a .next/static "$1/.next/static"
    if [ -d public ]; then cp -a public "$1/public"; fi
    git -C "$0" rev-parse --short HEAD > "$1/REVISION"
  ' "$APP_DIR" "$dir" >&2 || { rm -rf "$dir"; return 1; }  # callers use it in `if`: no set -e
  echo "$dir"
}

current_release() {
  if [ -L "$CURRENT" ]; then readlink -f "$CURRENT"; fi
}

# Point current at a release folder (atomic rename of a new symlink).
switch_release() {
  ln -sfn "$1" "$WEB_ROOT/.current.new"
  chown -h "$TTK_USER:$TTK_USER" "$WEB_ROOT/.current.new"
  mv -Tf "$WEB_ROOT/.current.new" "$CURRENT"
  note "web release now $(basename "$1") (commit $(cat "$1/REVISION" 2>/dev/null || echo '?'))"
}

# The release just before the current one (by name = by build time), or nothing.
previous_release() {
  local cur prev="" dir
  cur="$(current_release)"
  for dir in "$RELEASES"/*/; do
    dir="${dir%/}"
    [ -d "$dir" ] || continue
    if [ "$dir" = "$cur" ]; then break; fi
    prev="$dir"
  done
  echo "$prev"
}

# Keep the newest KEEP_RELEASES release folders, and always the current one.
prune_releases() {
  local cur dir
  local -a all=()
  cur="$(current_release)"
  for dir in "$RELEASES"/*/; do
    [ -d "$dir" ] && all+=("${dir%/}")
  done
  local count=${#all[@]} i
  for ((i = 0; i < count - KEEP_RELEASES; i++)); do
    dir="${all[$i]}"
    if [ "$dir" != "$cur" ]; then
      rm -rf "$dir"
      note "removed old release $(basename "$dir")"
    fi
  done
}

# systemd units and /etc/caddy/Caddyfile from the checkout ({SERVER_IP} substituted). Only files
# that changed are replaced; Caddy is reloaded when its file changed (or it is not running).
install_units_and_caddy() {
  local ip="$1" unit tmp changed=0
  for unit in ttk-api.service ttk-web.service; do
    if ! cmp -s "$APP_DIR/deploy/$unit" "/etc/systemd/system/$unit"; then
      install -m 644 "$APP_DIR/deploy/$unit" "/etc/systemd/system/$unit"
      note "installed /etc/systemd/system/$unit"
      changed=1
    fi
  done
  if [ "$changed" = 1 ]; then systemctl daemon-reload; fi
  systemctl enable ttk-api ttk-web caddy >/dev/null 2>&1

  tmp="$(mktemp)"
  sed "s/{SERVER_IP}/$ip/g" "$APP_DIR/deploy/Caddyfile.template" > "$tmp"
  if ! caddy validate --adapter caddyfile --config "$tmp" >/dev/null 2>&1; then
    caddy validate --adapter caddyfile --config "$tmp" || true
    rm -f "$tmp"
    die "the Caddyfile does not validate"
  fi
  if ! cmp -s "$tmp" /etc/caddy/Caddyfile; then
    install -m 644 "$tmp" /etc/caddy/Caddyfile
    note "installed /etc/caddy/Caddyfile for $ip"
    if systemctl is-active --quiet caddy; then systemctl reload caddy; fi
  fi
  rm -f "$tmp"
  systemctl is-active --quiet caddy || systemctl restart caddy
}

# API (direct), web (direct), and both through Caddy on https://SERVER_IP, connecting to
# 127.0.0.1:443 so it also works when the public IP is not on this machine (NAT).
health_check() {
  local ip="$1" tries="${2:-40}" i tls_opt=(-k)
  [ -f "$CADDY_CA" ] && tls_opt=(--cacert "$CADDY_CA")
  for ((i = 1; i <= tries; i++)); do
    if curl -fsS -o /dev/null --max-time 5 http://127.0.0.1:8000/api/health 2>/dev/null &&
      curl -fsS -o /dev/null --max-time 10 http://127.0.0.1:3000/login 2>/dev/null &&
      curl -fsS -o /dev/null --max-time 10 "${tls_opt[@]}" --connect-to "$ip:443:127.0.0.1:443" "https://$ip/api/health" 2>/dev/null &&
      curl -fsS -o /dev/null --max-time 10 "${tls_opt[@]}" --connect-to "$ip:443:127.0.0.1:443" "https://$ip/login" 2>/dev/null; then
      note "health OK: https://$ip/api/health (database reachable) and https://$ip/login"
      return 0
    fi
    sleep 2
  done
  warn "health check failed after $((tries * 2))s:"
  curl -sS --max-time 5 http://127.0.0.1:8000/api/health >&2 || true
  echo >&2
  curl -sS -o /dev/null -w 'web http://127.0.0.1:3000/login -> %{http_code}\n' --max-time 10 http://127.0.0.1:3000/login >&2 || true
  curl -sS -o /dev/null -w 'caddy https -> %{http_code}\n' --max-time 10 "${tls_opt[@]}" --connect-to "$ip:443:127.0.0.1:443" "https://$ip/api/health" >&2 || true
  return 1
}
