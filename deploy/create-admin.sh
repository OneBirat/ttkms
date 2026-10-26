#!/usr/bin/env bash
# Create the first admin (and the first branch): sudo bash /opt/ttk/app/deploy/create-admin.sh [--force]
set -euo pipefail; exec runuser -u ttk -- bash -c 'set -a; . /etc/ttk/app.env; set +a; cd /opt/ttk/app && exec /opt/ttk/venv/bin/python -m app.cli create-admin "$@"' create-admin "$@"
