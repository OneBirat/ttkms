#!/usr/bin/env bash
# TTK — PostgreSQL setup for the production server (Ubuntu 22.04 / 24.04, no Docker)
#
#   sudo bash setup-postgres.sh                 # PostgreSQL 16 (default)
#   sudo PG_VERSION=17 bash setup-postgres.sh   # use the same major version you run locally
#
# What it does (safe to run again):
#   1. 2 GB swap if the server has none
#   2. PostgreSQL from the official repo (apt.postgresql.org)
#   3. Tuning for 4 GB RAM / 1 CPU, listening on localhost only
#   4. Database "ttk" + login role "ttk" with a random password
#   5. Writes the connection details to /etc/ttk/db.env (root-only)
#   6. Nightly backup (pg_dump), last 7 days kept in /var/backups/ttk
set -euo pipefail

PG_VERSION="${PG_VERSION:-16}"
DB_NAME="${DB_NAME:-ttk}"
DB_USER="${DB_USER:-ttk}"
ENV_FILE=/etc/ttk/db.env
BACKUP_DIR=/var/backups/ttk
KEEP_DAYS="${KEEP_DAYS:-7}"

if [ "$(id -u)" -ne 0 ]; then echo "Run it with sudo: sudo bash $0"; exit 1; fi
step() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
PGPORT=5432
psql_pg() { runuser -u postgres -- psql -X -p "$PGPORT" -v ON_ERROR_STOP=1 "$@"; }

step "1/6 Swap"
if swapon --show --noheadings | grep -q .; then
  echo "Swap already on:"; swapon --show
elif systemd-detect-virt -cq 2>/dev/null; then
  echo "Container detected — skipping swap"
else
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-ttk-swap.conf
  sysctl -q -p /etc/sysctl.d/99-ttk-swap.conf
  echo "2 GB swap created"
fi

step "2/6 Install PostgreSQL $PG_VERSION"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q postgresql-common ca-certificates openssl
/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y >/dev/null
apt-get install -y -q "postgresql-$PG_VERSION" "postgresql-client-$PG_VERSION"
systemctl enable --now postgresql >/dev/null 2>&1 || true
pg_ctlcluster "$PG_VERSION" main start 2>/dev/null || true
PGPORT="$(pg_conftool -s "$PG_VERSION" main show port)"
psql_pg -tAc 'SELECT version()'
[ "$PGPORT" = "5432" ] || echo "NOTE: PostgreSQL $PG_VERSION is on port $PGPORT (another version already uses 5432)"

step "3/6 Tuning (4 GB RAM, 1 CPU, localhost only)"
CONF_DIR="/etc/postgresql/$PG_VERSION/main/conf.d"
mkdir -p "$CONF_DIR"
cat > "$CONF_DIR/ttk.conf" <<'EOF'
# TTK — tuned for 4 GB RAM / 1 CPU shared with the API and the web app
listen_addresses = 'localhost'
max_connections = 40
shared_buffers = 512MB
effective_cache_size = 2GB
work_mem = 8MB
maintenance_work_mem = 128MB
random_page_cost = 1.1
wal_compression = on
max_wal_size = 1GB
checkpoint_completion_target = 0.9
log_min_duration_statement = 500ms
log_line_prefix = '%m [%p] %u@%d '
EOF
chown -R postgres:postgres "$CONF_DIR"
pg_ctlcluster "$PG_VERSION" main restart
echo "Settings in $CONF_DIR/ttk.conf"

step "4/6 Database \"$DB_NAME\" and role \"$DB_USER\""
NEW_PASS=""
if [ "$(psql_pg -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER'")" = "1" ]; then
  echo "Role $DB_USER already exists — password left unchanged"
else
  NEW_PASS="$(openssl rand -hex 24)"
  psql_pg -q <<SQL
CREATE ROLE "$DB_USER" LOGIN PASSWORD '$NEW_PASS';
SQL
  echo "Role $DB_USER created"
fi
if [ "$(psql_pg -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'")" = "1" ]; then
  echo "Database $DB_NAME already exists — left as it is"
else
  runuser -u postgres -- createdb -p "$PGPORT" -O "$DB_USER" -E UTF8 -T template0 "$DB_NAME"
  echo "Database $DB_NAME created (owner $DB_USER)"
fi
psql_pg -q -c "REVOKE ALL ON DATABASE \"$DB_NAME\" FROM PUBLIC; GRANT CONNECT, TEMP ON DATABASE \"$DB_NAME\" TO \"$DB_USER\";"

step "5/6 Connection details"
if [ -n "$NEW_PASS" ]; then
  mkdir -p "$(dirname "$ENV_FILE")"
  umask 077
  cat > "$ENV_FILE" <<EOF
DB_HOST=127.0.0.1
DB_PORT=$PGPORT
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$NEW_PASS
DATABASE_URL=postgresql://$DB_USER:$NEW_PASS@127.0.0.1:$PGPORT/$DB_NAME
EOF
  chmod 600 "$ENV_FILE"
  echo "Saved to $ENV_FILE (root only). See it with: sudo cat $ENV_FILE"
else
  echo "Password unchanged; $ENV_FILE not touched"
fi
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  if PGPASSWORD="$DB_PASSWORD" psql -X -h 127.0.0.1 -p "$PGPORT" -U "$DB_USER" -d "$DB_NAME" -tAc 'SELECT 1' >/dev/null; then
    echo "Login test as $DB_USER: OK"
  else
    echo "Login test as $DB_USER FAILED"; exit 1
  fi
fi

step "6/6 Nightly backup"
install -d -m 700 "$BACKUP_DIR"
cat > /usr/local/bin/ttk-db-backup <<EOF
#!/usr/bin/env bash
# Dump the TTK database (custom format) and keep $KEEP_DAYS days.
# Restore (stop the API first): sudo sh -c 'runuser -u postgres -- pg_restore -p $PGPORT --clean --if-exists -d $DB_NAME < $BACKUP_DIR/<file>.dump'
set -euo pipefail
F="$BACKUP_DIR/$DB_NAME-\$(date +%F-%H%M).dump"
runuser -u postgres -- pg_dump -p $PGPORT -Fc "$DB_NAME" > "\$F.part"
mv "\$F.part" "\$F"
chmod 600 "\$F"
find "$BACKUP_DIR" -name '$DB_NAME-*.dump' -mtime +$((KEEP_DAYS - 1)) -delete
echo "\$(date '+%F %T') backup ok: \$F (\$(du -h "\$F" | cut -f1))"
EOF
chmod 700 /usr/local/bin/ttk-db-backup
TZNAME="$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || echo UTC)"
case "$TZNAME" in
  Asia/Kathmandu|Asia/Katmandu) CRON_TIME="30 2" ;;   # 02:30 Nepal time
  *)                            CRON_TIME="45 20" ;;  # 20:45 UTC = 02:30 Nepal time
esac
echo "$CRON_TIME * * * root /usr/local/bin/ttk-db-backup >> /var/log/ttk-db-backup.log 2>&1" > /etc/cron.d/ttk-db-backup
chmod 644 /etc/cron.d/ttk-db-backup
/usr/local/bin/ttk-db-backup
echo "Runs daily ($CRON_TIME, server timezone $TZNAME); files in $BACKUP_DIR"

step "Done"
echo "PostgreSQL $PG_VERSION listening on:"
if command -v ss >/dev/null; then ss -ltn "sport = :$PGPORT" | tail -n +2 | awk '{print "  " $4}'; else psql_pg -tAc 'SHOW listen_addresses'; fi
if command -v ufw >/dev/null && ufw status | grep -qE "(^|[^0-9])$PGPORT(/tcp)?[[:space:]]"; then
  echo "WARNING: ufw has a rule for port $PGPORT — remove it, the database must stay private."
fi
echo
echo "Next: put DATABASE_URL from $ENV_FILE into the API's .env (keep your driver prefix, e.g. postgresql+asyncpg://),"
echo "then run the migrations in order: core -> admin -> payroll -> attendance."
