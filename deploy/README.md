# TTK production deployment

One Ubuntu server (22.04 or 24.04, 4 GB RAM, 1 CPU), no Docker, reached by its IP address over
HTTPS with Caddy's own certificate authority. Everything below runs on the server.

```
Browser ──https://SERVER_IP──▶ Caddy :443 ──/api/*──▶ ttk-api  127.0.0.1:8000  gunicorn + 2 uvicorn workers ──▶ PostgreSQL 16 (localhost)
        ──http://SERVER_IP───▶ Caddy :80   (/ttk-ca.crt; the rest → https)
                                          └─else───▶ ttk-web  127.0.0.1:3000  Next.js standalone (/opt/ttk/web/current)
```

| What | Where |
|---|---|
| Code (git clone, owned by `ttk`) | `/opt/ttk/app` |
| Python venv | `/opt/ttk/venv` |
| Web releases (last 3 kept) | `/opt/ttk/web/releases/<timestamp>`, `/opt/ttk/web/current` → the live one |
| Run-time config (root:ttk 640) | `/etc/ttk/app.env` (from `deploy/app.env.example`) |
| Database credentials (root 600) | `/etc/ttk/db.env` (written by `deploy/setup-postgres.sh`) |
| Uploads: staff photos (ttk 750) | `/var/lib/ttk/uploads`, served only through the API, signed in |
| Caddy config / its CA | `/etc/caddy/Caddyfile`, `/var/lib/caddy/.local/share/caddy/pki/` |
| Services | `ttk-api`, `ttk-web`, `caddy`, `postgresql` |

"Today" (attendance, the dashboard, BS dates) is always computed in Asia/Kathmandu by the code;
the server's timezone is set to Asia/Kathmandu as well, so logs and cron match.

## First install

1. **User and code.** The system user `ttk` (home `/opt/ttk`, no login shell) and a read-only
   GitHub deploy key for it:

   ```sh
   sudo useradd --system --home-dir /opt/ttk --create-home --shell /usr/sbin/nologin ttk
   sudo -u ttk -H mkdir -p -m 700 /opt/ttk/.ssh
   sudo -u ttk -H ssh-keygen -t ed25519 -N '' -C ttk-deploy -f /opt/ttk/.ssh/id_ed25519
   sudo cat /opt/ttk/.ssh/id_ed25519.pub      # add it to the repo: Settings → Deploy keys (read-only)
   sudo -u ttk -H git clone git@github.com:OneBirat/ttkms.git /opt/ttk/app
   ```

2. **Install** (about 10-15 minutes; safe to run again):

   ```sh
   cd /opt/ttk/app
   sudo SERVER_IP=1.2.3.4 bash deploy/server-install.sh
   ```

   It sets the timezone, installs the packages (Python 3.12, Node 22, Caddy, the PDF libraries and
   fonts, ufw), sets up PostgreSQL (`deploy/setup-postgres.sh`, only when `/etc/ttk/db.env` is
   missing), writes `/etc/ttk/app.env` with a random `SECRET_KEY` (first run only, never
   overwritten), installs the Python deps, runs the migrations (core → admin → payroll →
   attendance), builds the web app into the first release, installs the systemd units and the
   Caddyfile, turns on the firewall (SSH, 80, 443 only), and checks
   `https://SERVER_IP/api/health`.

3. **First admin** (also creates the first branch when there is none):

   ```sh
   sudo bash /opt/ttk/app/deploy/create-admin.sh
   ```

   It asks for the full name, the username or phone number, and the password (hidden, twice). It
   refuses while an admin exists; `--force` adds another admin or makes an existing login admin
   again with a new password (for a forgotten admin password).

4. **Certificates on the devices**: install the CA once on every phone and PC (below), then open
   `https://SERVER_IP`.

## Update

```sh
sudo bash /opt/ttk/app/deploy/server-update.sh
```

It runs `git pull --ff-only` (as `ttk`), installs the Python deps, runs the migrations, builds a
new web release next to the live one, switches `current` to it, restarts `ttk-api` and `ttk-web`,
and runs the health check. Changed systemd units or Caddyfile in the repo are installed too.

- **The build fails:** nothing is switched and the site keeps running the previous release. The
  API is not restarted, but the new code and migrations are already in place: fix the build and
  run the update again.
- **The health check fails:** the previous web release is put back and the script says whether
  the site is healthy again. If the API is what fails, look at `journalctl -u ttk-api`.

### Rollback

```sh
sudo bash /opt/ttk/app/deploy/server-update.sh --rollback
```

This switches `current` back to the release before it and restarts `ttk-web`. It rolls back only
the web app: the API code (`/opt/ttk/app`) and the database stay as they are. Migrations are
never undone automatically. To run older API code too, check out that commit as `ttk`
(`sudo -u ttk -H git -C /opt/ttk/app checkout <commit>`, commit in each release's `REVISION`
file) and restart `ttk-api`, only if the database schema still fits it.

## Logs, status, restart

```sh
journalctl -u ttk-api -f            # API (gunicorn access log + errors)
journalctl -u ttk-web -f            # Next.js
journalctl -u caddy -f              # Caddy (HTTPS, access log)
journalctl -u ttk-api -u ttk-web --since "1 hour ago"

systemctl status ttk-api ttk-web caddy postgresql
sudo systemctl restart ttk-api      # after editing /etc/ttk/app.env: restart both
sudo systemctl restart ttk-web
sudo systemctl reload caddy

curl -s http://127.0.0.1:8000/api/health     # {"status":"ok","database":"ok"}
ls -l /opt/ttk/web/current; cat /opt/ttk/web/current/REVISION
```

`/etc/ttk/app.env` holds the run-time settings (every variable is explained in
`deploy/app.env.example`). Edit it with `sudo nano /etc/ttk/app.env`, then restart both services.
Changing `SECRET_KEY` signs everyone out. To change the server's IP, edit `SERVER_IP` there and
run `server-install.sh` again; a new certificate is issued for the new IP by the same CA, so the
devices keep trusting it.

Other commands, run as `ttk` with the config loaded:

```sh
sudo runuser -u ttk -- bash -c 'set -a; . /etc/ttk/app.env; set +a; cd /opt/ttk/app && /opt/ttk/venv/bin/python -m app.cli photos-upgrade'
```

`seed-demo` refuses to run in production (`APP_ENV=prod`). Backups are not part of this setup yet;
`setup-postgres.sh` installs a nightly database dump (`/var/backups/ttk`), and the uploads folder
and Caddy's CA (`/var/lib/caddy/.local/share/caddy/pki`) are not backed up.

## Installing the CA certificate

Caddy signs the site's certificate with its own root certificate. Each device must trust that root
once, otherwise browsers show a warning. Download it over plain http from
**`http://SERVER_IP/ttk-ca.crt`**.

That download is not protected, so check it is the real one. Compare its SHA-256 fingerprint with
the server's:

```sh
sudo openssl x509 -in /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt -noout -fingerprint -sha256
```

The root certificate is valid for 10 years. Caddy renews the site certificate by itself, and
devices keep trusting it. If `/var/lib/caddy` is lost, Caddy makes a new root, and every device
must install it again.

### Android

1. Open `http://SERVER_IP/ttk-ca.crt` in Chrome. The file downloads.
2. Settings → Security & privacy → More security settings → Encryption & credentials → Install a
   certificate → **CA certificate** → Install anyway. Pick `ttk-ca.crt` in Downloads, then confirm
   with the screen lock.
   - Samsung: Settings → Security and privacy → More security settings → Install from device
     storage → CA certificate.
   - Older Android: Settings → Security → Install from storage.
3. Open `https://SERVER_IP` in Chrome.

### iPhone / iPad

1. Open `http://SERVER_IP/ttk-ca.crt` in **Safari** (not Chrome) and tap Allow. A profile
   downloads.
2. Settings → General → VPN & Device Management → "Caddy Local Authority" → Install. Enter the
   passcode, then tap Install again.
3. Turn on full trust. This step is easy to miss: Settings → General → About → Certificate Trust
   Settings → switch on "Caddy Local Authority - … Root".
4. Open `https://SERVER_IP`.

### Windows

1. Open `http://SERVER_IP/ttk-ca.crt` in the browser, then open the downloaded file.
2. Install Certificate → Current User → **Place all certificates in the following store** →
   Browse → **Trusted Root Certification Authorities** → Next → Finish. Answer Yes to the
   security warning.
3. Restart the browser, then open `https://SERVER_IP`. Chrome and Edge use the Windows store.
   Firefox has its own: Settings → Privacy & Security → Certificates → View Certificates →
   Authorities → Import → `ttk-ca.crt` → tick "Trust this CA to identify websites".

## Troubleshooting

- **The browser warns about the certificate:** the CA is not installed on that device (or, on
  iPhone, full trust is off). Check you open `https://SERVER_IP`, not another address: the
  certificate is only for that IP.
- **502 from Caddy:** `ttk-api` or `ttk-web` is down. Run `systemctl status ttk-api ttk-web` and
  check `journalctl -u ttk-api -n 100`.
- **`/api/health` says the database is unreachable:** run `systemctl status postgresql`, and check
  that `DATABASE_URL` in `/etc/ttk/app.env` matches `/etc/ttk/db.env` (with the
  `postgresql+asyncpg://` prefix).
- **PDF downloads fail (503):** WeasyPrint cannot load Pango. Run `server-install.sh` again, it
  installs the libraries.
- **The build runs out of memory:** the build uses up to 1.5 GB of Node heap, and
  `setup-postgres.sh` adds 2 GB of swap. Stop `ttk-web` during the build only if it still fails.
