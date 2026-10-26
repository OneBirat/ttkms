#!/usr/bin/env bash
# TTK: deploy the latest code on the production server.
#
#   sudo bash /opt/ttk/app/deploy/server-update.sh              # pull, migrate, build, switch, restart
#   sudo bash /opt/ttk/app/deploy/server-update.sh --rollback   # back to the previous web release
#
# Update: git pull --ff-only (as ttk), Python deps, migrations, a new web release (built next to
# the running one), switch the current symlink, restart ttk-api and ttk-web, health check.
# If the build fails nothing is switched; if the health check fails the previous web release is
# put back. Rollback only switches the web release: the API code and the database stay as they are.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/lib.sh
. "$HERE/lib.sh"

MODE=update
case "${1:-}" in
  "") ;;
  --rollback) MODE=rollback ;;
  -h | --help) sed -n '2,11p' "$0"; exit 0 ;;
  *) die "unknown option '$1' (use --rollback or nothing)" ;;
esac

require_root
take_lock
[ -f "$APP_ENV_FILE" ] || die "$APP_ENV_FILE is missing: run deploy/server-install.sh first"
SERVER_IP="$(env_value "$APP_ENV_FILE" SERVER_IP)"
[ -n "$SERVER_IP" ] || die "SERVER_IP is not set in $APP_ENV_FILE"

restart_web() {
  systemctl restart ttk-web
}

if [ "$MODE" = rollback ]; then
  step "Rollback of the web release"
  CUR="$(current_release)"
  PREV="$(previous_release)"
  [ -n "$PREV" ] || die "no release older than $(basename "${CUR:-none}") in $RELEASES"
  note "from $(basename "$CUR") (commit $(cat "$CUR/REVISION" 2>/dev/null || echo '?'))"
  switch_release "$PREV"
  restart_web
  if health_check "$SERVER_IP"; then
    note "rolled back the web app only: the API code in $APP_DIR stays at commit $(as_ttk git -C "$APP_DIR" rev-parse --short HEAD)."
    exit 0
  fi
  die "rolled back, but the health check fails: journalctl -u ttk-api -u ttk-web -n 100"
fi

OLD_RELEASE="$(current_release)"
[ -n "$OLD_RELEASE" ] || die "no current web release: run deploy/server-install.sh first"

step "1/6 git pull"
OLD_REV="$(as_ttk git -C "$APP_DIR" rev-parse --short HEAD)"
as_ttk git -C "$APP_DIR" pull --ff-only
NEW_REV="$(as_ttk git -C "$APP_DIR" rev-parse --short HEAD)"
if [ "$OLD_REV" = "$NEW_REV" ]; then note "already at $NEW_REV (rebuilding anyway)"; else note "$OLD_REV -> $NEW_REV"; fi
as_ttk git -C "$APP_DIR" log --oneline "$OLD_REV..$NEW_REV" | sed -n '1,20s/^/   /p' || true

step "2/6 Python dependencies"
install_python_deps

step "3/6 Database migrations (${MIGRATION_SECTIONS[*]})"
run_migrations

step "4/6 Web build"
if ! NEW_RELEASE="$(build_release)"; then
  warn "the web build failed: the site keeps running release $(basename "$OLD_RELEASE")."
  warn "The API was NOT restarted; the new code and migrations are in place and it will run them at its next restart."
  exit 1
fi

step "5/6 Switch and restart"
switch_release "$NEW_RELEASE"
install_units_and_caddy "$SERVER_IP"
systemctl restart ttk-api ttk-web

step "6/6 Health check"
if health_check "$SERVER_IP"; then
  prune_releases
  note "update done: commit $NEW_REV, web release $(basename "$NEW_RELEASE")"
  exit 0
fi

warn "unhealthy after the update: putting back web release $(basename "$OLD_RELEASE")"
switch_release "$OLD_RELEASE"
restart_web
# It never passed a health check: drop it so a later --rollback cannot land on it.
rm -rf "$NEW_RELEASE"
note "removed release $(basename "$NEW_RELEASE")"
if health_check "$SERVER_IP" 20; then
  die "restored the previous web release; it is healthy again. The API runs commit $NEW_REV: if the API was the problem, see journalctl -u ttk-api -n 100"
fi
die "restored the previous web release, but the site is still unhealthy (the API probably fails at commit $NEW_REV): journalctl -u ttk-api -u ttk-web -n 100"
