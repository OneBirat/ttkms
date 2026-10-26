#!/usr/bin/env bash
# Nightly backup: the PostgreSQL database AND the media folder (employee photos - they live on the
# server's disk, not in the database). Run it from cron, e.g. every night at 02:30:
#
#   30 2 * * *  cd /srv/ttkms && BACKUP_DIR=/var/backups/ttk scripts/backup.sh >> /var/log/ttk-backup.log 2>&1
#
# Each run writes BACKUP_DIR/ttk-YYYYMMDD-HHMMSS/ with
#   db.dump         pg_dump --format=custom   (restore: pg_restore --clean --dbname=... db.dump)
#   media.tar.gz    the whole media folder    (restore: tar -xzf media.tar.gz -C <parent of MEDIA_DIR>)
# and checks both files can be read back before keeping the run. Runs older than KEEP_DAYS are
# deleted (only folders named ttk-*). The database URL and the media folder come from the app's
# own settings (.env), so the backup follows MEDIA_DIR / DATABASE_URL wherever they point.
#
# Settings (environment): BACKUP_DIR (default /var/backups/ttk), KEEP_DAYS (default 14),
# PY (default .venv/bin/python). Needs pg_dump / pg_restore of the server's major version.
set -euo pipefail

cd "$(dirname "$0")/.."
PY=${PY:-.venv/bin/python}
BACKUP_DIR=${BACKUP_DIR:-/var/backups/ttk}
KEEP_DAYS=${KEEP_DAYS:-14}

# host, port, user, password, database, media folder - from app.config (never echoed).
IFS=$'\t' read -r PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE MEDIA_DIR < <(
  "$PY" - <<'PYEOF'
from sqlalchemy.engine import make_url

from app.config import settings

url = make_url(settings.database_url)
print(
    "\t".join(
        [
            url.host or "localhost",
            str(url.port or 5432),
            url.username or "",
            url.password or "",
            url.database or "",
            str(settings.media_dir.resolve()),
        ]
    )
)
PYEOF
)
export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE

stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"
work=$(mktemp -d "$BACKUP_DIR/.ttk-$stamp.XXXXXX")
trap 'rm -rf "$work"' EXIT

echo "[$(date -Iseconds)] backup $stamp: database $PGDATABASE@$PGHOST:$PGPORT, media $MEDIA_DIR"

pg_dump --format=custom --no-owner --file="$work/db.dump"
pg_restore --list "$work/db.dump" > /dev/null

if [[ -d "$MEDIA_DIR" ]]; then
  tar -czf "$work/media.tar.gz" -C "$(dirname "$MEDIA_DIR")" "$(basename "$MEDIA_DIR")"
else
  echo "warning: media folder $MEDIA_DIR does not exist yet - backing up an empty one" >&2
  empty=$(mktemp -d)
  mkdir "$empty/$(basename "$MEDIA_DIR")"
  tar -czf "$work/media.tar.gz" -C "$empty" "$(basename "$MEDIA_DIR")"
  rm -rf "$empty"
fi
files=$(tar -tzf "$work/media.tar.gz" | grep -vc '/$' || true)

mv "$work" "$BACKUP_DIR/ttk-$stamp"
trap - EXIT
echo "[$(date -Iseconds)] kept $BACKUP_DIR/ttk-$stamp ($(du -sh "$BACKUP_DIR/ttk-$stamp" | cut -f1), $files media file(s))"

find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name 'ttk-*' -mtime +"$KEEP_DAYS" -print -exec rm -rf {} +
