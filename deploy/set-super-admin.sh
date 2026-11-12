#!/usr/bin/env bash
# Make ONE admin the super admin (asks to confirm; moves the flag when another user holds it):
#   sudo bash /opt/ttk/app/deploy/set-super-admin.sh <username or phone>
set -euo pipefail; exec runuser -u ttk -- bash -c 'set -a; . /etc/ttk/app.env; set +a; cd /opt/ttk/app && exec /opt/ttk/venv/bin/python -m app.cli set-super-admin "$@"' set-super-admin "$@"
