#!/usr/bin/env bash
# TTK: first install (and repair) of the production server. Ubuntu 22.04 / 24.04, no Docker.
#
#   cd /opt/ttk/app && sudo SERVER_IP=1.2.3.4 bash deploy/server-install.sh
#
# Safe to run again: it never overwrites /etc/ttk/app.env or /etc/ttk/db.env, and each run builds
# a fresh web release and switches to it. Prerequisites: the system user ttk (home /opt/ttk) and
# this checkout at /opt/ttk/app owned by ttk. See deploy/README.md.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/lib.sh
. "$HERE/lib.sh"

require_root
take_lock

[ "$(cd "$HERE/.." && pwd -P)" = "$(readlink -f "$APP_DIR")" ] ||
  die "run it from the checkout in $APP_DIR (this one is $(cd "$HERE/.." && pwd -P))"
id "$TTK_USER" >/dev/null 2>&1 || die "system user $TTK_USER is missing; create it first (deploy/README.md)"
[ "$(stat -c %U "$APP_DIR")" = "$TTK_USER" ] || die "$APP_DIR must be owned by $TTK_USER (chown -R $TTK_USER:$TTK_USER $APP_DIR)"

# SERVER_IP: required on the first run; afterwards it defaults to the one in app.env.
if [ -f "$APP_ENV_FILE" ]; then
  SAVED_IP="$(env_value "$APP_ENV_FILE" SERVER_IP)"
  SERVER_IP="${SERVER_IP:-$SAVED_IP}"
  [ "$SERVER_IP" = "$SAVED_IP" ] ||
    die "SERVER_IP=$SERVER_IP but $APP_ENV_FILE says $SAVED_IP. Edit SERVER_IP there first, then run again."
fi
SERVER_IP="${SERVER_IP:-}"
[ -n "$SERVER_IP" ] || die "set the server's IP: sudo SERVER_IP=1.2.3.4 bash deploy/server-install.sh"
[[ "$SERVER_IP" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || die "SERVER_IP must be an IPv4 address like 1.2.3.4 (got '$SERVER_IP')"

# shellcheck source=/dev/null
. /etc/os-release
case "${VERSION_ID:-}" in
  22.04 | 24.04) ;;
  *) warn "tested on Ubuntu 22.04 and 24.04 only; this is ${PRETTY_NAME:-unknown}" ;;
esac
export DEBIAN_FRONTEND=noninteractive

step "a. Timezone Asia/Kathmandu"
timedatectl set-timezone Asia/Kathmandu
note "$(timedatectl show -p Timezone --value)"

step "b. System packages"
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg git openssl build-essential pkg-config \
  software-properties-common debian-keyring debian-archive-keyring apt-transport-https ufw

# Python 3.12 (pyproject.toml: >=3.12,<3.13): in Ubuntu 24.04, from deadsnakes on 22.04.
if ! apt-cache show python3.12-venv >/dev/null 2>&1; then
  note "adding ppa:deadsnakes/ppa for Python 3.12"
  add-apt-repository -y ppa:deadsnakes/ppa
  apt-get update -q
fi

# Node 22 LTS from NodeSource (pinned above Ubuntu's own nodejs).
install -d -m 755 /etc/apt/keyrings
if [ ! -f /etc/apt/sources.list.d/nodesource.list ]; then
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key |
    gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  printf 'Package: nodejs\nPin: origin deb.nodesource.com\nPin-Priority: 600\n' > /etc/apt/preferences.d/nodesource
fi

# Caddy from its official repository (Cloudsmith).
if [ ! -f /etc/apt/sources.list.d/caddy-stable.list ]; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key |
    gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
fi
apt-get update -q

# WeasyPrint (PDF exports, barcode sheets, payslips) needs Pango + HarfBuzz; the fonts it embeds
# (IBM Plex, Noto Sans Devanagari) ship in static/vendor/fonts, fonts-noto-core is the system
# fallback for Devanagari and anything else. Excel (openpyxl), barcodes (Code 128 drawn by our own
# code) and photos (Pillow wheels) need nothing from apt.
PKGS=(python3.12 python3.12-venv python3.12-dev nodejs caddy
  libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libfontconfig1 fontconfig shared-mime-info
  fonts-noto-core fonts-dejavu-core)
# A separate package on 24.04; part of libharfbuzz0b on 22.04.
if apt-cache show libharfbuzz-subset0 >/dev/null 2>&1; then PKGS+=(libharfbuzz-subset0); fi
apt-get install -y -q "${PKGS[@]}"
fc-cache -f >/dev/null
note "$("$PYTHON_BIN" --version), node $(node --version), $(caddy version | cut -d' ' -f1)"
[ "$(node --version | cut -d. -f1)" = "v22" ] || die "node $(node --version) installed, expected v22 (check /etc/apt/preferences.d/nodesource)"

step "c. PostgreSQL"
if [ -f "$DB_ENV_FILE" ]; then
  note "$DB_ENV_FILE exists: PostgreSQL already set up (setup-postgres.sh not run)"
else
  bash "$HERE/setup-postgres.sh"
  [ -f "$DB_ENV_FILE" ] || die "setup-postgres.sh did not write $DB_ENV_FILE (the role existed already?). Reset the ttk role's password and write $DB_ENV_FILE by hand, then run again."
fi

step "d. Folders and $APP_ENV_FILE"
chown "$TTK_USER:$TTK_USER" "$TTK_HOME"
chmod 755 "$TTK_HOME"
install -d -o root -g "$TTK_USER" -m 750 "$ETC_DIR"
install -d -o "$TTK_USER" -g "$TTK_USER" -m 750 "$DATA_DIR" "$UPLOADS"
install -d -o "$TTK_USER" -g "$TTK_USER" -m 755 "$WEB_ROOT" "$RELEASES"
if [ -f "$APP_ENV_FILE" ]; then
  note "$APP_ENV_FILE exists: left as it is"
  DB_URL_NOW="$(env_value "$APP_ENV_FILE" DATABASE_URL)"
  DB_URL_RAW="$(env_value "$DB_ENV_FILE" DATABASE_URL)"
  [ "${DB_URL_NOW#postgresql+asyncpg://}" = "${DB_URL_RAW#postgresql://}" ] ||
    warn "DATABASE_URL in $APP_ENV_FILE does not match $DB_ENV_FILE (fine if you changed it on purpose)"
else
  DB_URL="postgresql+asyncpg://$(env_value "$DB_ENV_FILE" DB_USER):$(env_value "$DB_ENV_FILE" DB_PASSWORD)@$(env_value "$DB_ENV_FILE" DB_HOST):$(env_value "$DB_ENV_FILE" DB_PORT)/$(env_value "$DB_ENV_FILE" DB_NAME)"
  SECRET="$(openssl rand -hex 32)"
  TMP_ENV="$(mktemp "$ETC_DIR/.app.env.XXXXXX")"
  # The values are hex / URL characters only: no sed metacharacters except ":" "/" "@" "." "+".
  sed -e "s|^SECRET_KEY=.*|SECRET_KEY=$SECRET|" \
    -e "s|^DATABASE_URL=.*|DATABASE_URL=$DB_URL|" \
    -e "s|^SERVER_IP=.*|SERVER_IP=$SERVER_IP|" \
    "$HERE/app.env.example" > "$TMP_ENV"
  chown root:"$TTK_USER" "$TMP_ENV"
  chmod 640 "$TMP_ENV"
  mv "$TMP_ENV" "$APP_ENV_FILE"
  note "created $APP_ENV_FILE (random SECRET_KEY, DATABASE_URL from $DB_ENV_FILE)"
fi
chown root:"$TTK_USER" "$APP_ENV_FILE"
chmod 640 "$APP_ENV_FILE"
grep -q '^SECRET_KEY=CHANGE_ME$' "$APP_ENV_FILE" && die "SECRET_KEY in $APP_ENV_FILE is still CHANGE_ME"

step "e. Python venv and dependencies"
install_python_deps

step "f. Database migrations (${MIGRATION_SECTIONS[*]})"
run_migrations

step "g. Web build and release"
if ! NEW_RELEASE="$(build_release)"; then
  die "web build failed$( [ -L "$CURRENT" ] && echo "; the site keeps running $(basename "$(current_release)")")"
fi
switch_release "$NEW_RELEASE"
prune_releases

step "h. systemd units, Caddy, firewall"
install_units_and_caddy "$SERVER_IP"
systemctl restart ttk-api ttk-web

# SSH first, then the web ports. The OpenSSH profile is port 22; a custom sshd port is added too.
ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp >/dev/null
for port in $(sshd -T 2>/dev/null | awk '$1 == "port" { print $2 }'); do
  [ "$port" = 22 ] || ufw allow "$port/tcp" >/dev/null
done
ufw allow 80/tcp >/dev/null
ufw allow 443 >/dev/null  # tcp and udp (HTTP/3)
ufw --force enable >/dev/null
if ufw status | grep -qE '(^|[^0-9])5432(/tcp)?[[:space:]]'; then
  warn "ufw has a rule for 5432: remove it (sudo ufw status numbered; sudo ufw delete N)"
fi
ufw status | sed 's/^/   /'

step "i. Health check"
# Caddy writes its root certificate on first start; wait for it so curl can verify the chain.
for _ in $(seq 1 15); do [ -f "$CADDY_CA" ] && break; sleep 1; done
health_check "$SERVER_IP" || die "the site is not healthy: journalctl -u ttk-api -u ttk-web -u caddy -n 100"

step "j. Done"
cat <<EOF
   App:              https://$SERVER_IP
   CA certificate:   http://$SERVER_IP/ttk-ca.crt   (install it once per phone/PC: deploy/README.md)
   Web release:      $(basename "$(current_release)") (commit $(cat "$CURRENT/REVISION"))

   Next step: create the first admin (and the first branch):
     sudo bash $APP_DIR/deploy/create-admin.sh
EOF
