# TTK

Attendance and payroll for a kitchen-appliance business in Nepal (the stock module is paused).

- **Backend** (`app/`): Python 3.12, FastAPI as a JSON API under `/api`, SQLAlchemy 2 (async,
  asyncpg), Alembic, PostgreSQL 16, argon2 session-cookie auth, openpyxl (Excel), WeasyPrint (PDF).
- **Frontend** (`web/`): Next.js 15 (App Router, TypeScript, plain CSS). It proxies `/api/*` to the
  backend through `next.config.ts` rewrites, so the session cookie stays same-origin: no CORS, no
  tokens in the browser.
- **Database**: one database (`ttk`) with one Postgres schema per module - `core`, `stock`,
  `attendance`, `payroll`, `admin` - and one Alembic environment per module.
- **Modules** are switched on with `ENABLED_MODULES` in `.env` (comma-separated; default
  `attendance,payroll,admin`). A module that is not listed is hidden everywhere - no API routes,
  no sidebar section, no dashboard widgets, no migrations - while its code and tables stay put.

## Stock module (paused)

Stock module is paused (2026-10-24). Code is on branch `feat/stock`, tag
`stock-paused-2026-10-24`. To re-enable: merge the branch, add `stock` to `ENABLED_MODULES`,
run `alembic -n stock upgrade head`.

What the switch does while `stock` is absent from `ENABLED_MODULES`:

- `app.main` never imports `app/modules/stock`, so `/api/stock/*` answers 404 and
  `GET /api/core/modules` lists neither the module nor its nav items;
- `make migrate` skips `migrations/stock/` (the schema is never upgraded, downgraded or dropped);
- the Next.js sidebar is built from `/api/core/modules`, so the Stock section and Admin › Products
  are gone; `web/middleware.ts` sends `/stock/*` and `/admin/products` to `/module-off`; the
  dashboard renders no stock widgets; after login users land on Attendance;
- `web/app/(app)/stock/` and `app/modules/stock/` remain in the tree, unreachable.

Code outside a module that touches it must guard with `is_enabled("stock")`
(`app/core/modules.py`), and the test-suite builds a stock-enabled app with the `client_for`
fixture (`tests/conftest.py`), e.g. `async with client_for("stock,attendance,payroll,admin")`.

## Setup

```bash
/opt/homebrew/bin/python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env            # set DATABASE_URL password, SECRET_KEY, APP_PORT, WEB_PORT
brew install pango              # native libraries for WeasyPrint (PDF export)
make web-install                # npm install in web/
```

### Database (Docker)

```bash
docker compose -f docker-compose.dev.yml up -d
```

Starts `ttk-db` (Postgres 16 on `localhost:5433`, database `ttk`, user `ttk`) and Adminer on
`http://localhost:8080`. `docker/initdb/01-schemas.sql` creates the five schemas the first time
the volume is initialised; each Alembic environment also creates its own schema if it is missing.

### First run

```bash
make migrate                    # core first, then every enabled module that has migrations
make seed                       # branches, departments, 5 employees, settings, admin user
make dev                        # API on http://localhost:$APP_PORT  (8000)
make web-dev                    # UI  on http://localhost:$WEB_PORT  (3000) -> sign in there
```

`make seed` / `python -m app.cli create-admin` read `ADMIN_USERNAME` / `ADMIN_PASSWORD` from `.env`
when set, otherwise they prompt. Both commands are idempotent.

| Make target | What it does |
|---|---|
| `make dev` | `uvicorn app.main:app --reload --port $APP_PORT` |
| `make web-dev` / `make web-build` | Next.js dev server / production build (API_URL points at `$APP_PORT`) |
| `make migrate` | `alembic -n core upgrade head`, then each module in `ENABLED_MODULES` with versions |
| `make test` | pytest (creates and migrates the `ttk_test` database itself) |
| `make lint` / `make fmt` | ruff check + format check (+ `npm run lint` and `tsc` when `web/node_modules` exists) / auto-format |
| `make seed` / `make create-admin` | `python -m app.cli seed` / `create-admin` |

In development the OpenAPI schema is at `/api/openapi.json` and Swagger UI at `/api/docs`
(disabled when `APP_ENV=prod`, because Swagger UI loads from a CDN).

## Project layout

```
app/
  main.py          app factory: session middleware, CSRF, error handlers, module loading
  config.py        pydantic-settings (reads this worktree's .env)
  db.py            async engine, get_db dependency, declarative Base
  cli.py           create-admin, seed
  contracts.py     cross-module interfaces (AttendanceSummary + fake + registry)
  core/
    models.py      users, branches, departments, employees, settings, audit_log  (schema core)
    schemas.py     pydantic response/request models = the API contract used by web/
    auth.py        /api/auth/{csrf,login,me,logout}, CurrentUser, require_role(...)
    csrf.py        per-session CSRF token (X-CSRF-Token header, or csrf_token form field)
    sessions.py    session cookie with "Keep me signed in"
    routes.py      /api/core/modules, /api/registry, /api/dashboard, /api/today, /api/bsdate/convert
    bsdate.py      Bikram Sambat calendar API (data table pending - see below)
    export.py      to_xlsx(...), to_pdf(...)
    modules.py     Module / NavItem registry, is_enabled(name), load_modules()
    services.py    settings store, audit log, normalised-name lookups
    templates/     print/ templates for PDFs (the only server-rendered HTML)
  modules/
    stock/ attendance/ payroll/ admin/   each exports `module = Module(...)`, mounted at /api/<name>
                                         when listed in ENABLED_MODULES (stock is paused)
web/               Next.js app: app/ (routes), components/ (shell + ui/), lib/ (api, session, bsdate)
static/            css/print.css and vendor/fonts for PDFs; vendor/ also hosts the date-picker JS
scripts/           port_bs_calendar.py (generates app/core/bs_calendar_data.py from the vendor JS)
migrations/        env_helper.py + <module>/env.py + <module>/versions/
tests/             conftest.py, core/, stock/, attendance/, payroll/, admin/
```

## API in one minute

```bash
curl -c jar -b jar localhost:8000/api/auth/csrf                      # {"csrf_token": ...}
curl -c jar -b jar -H "X-CSRF-Token: <token>" -H 'Content-Type: application/json' \
     -d '{"username":"admin","password":"...","remember":true}' localhost:8000/api/auth/login
curl -b jar localhost:8000/api/auth/me          # {"user": {...}, "csrf_token": ...}
curl -b jar localhost:8000/api/core/modules     # {"enabled": [...], "nav": [...]} for the sidebar
curl -b jar localhost:8000/api/registry         # enabled modules + nav filtered to the user's role
curl -b jar localhost:8000/api/dashboard        # stats + widgets (kind "coming_soon" for stubs)
curl       localhost:8000/api/today             # AD + BS date strings for the header
```

Every POST/PUT/PATCH/DELETE needs the `X-CSRF-Token` header (the token comes back from
`/api/auth/csrf`, `/api/auth/login` and `/api/auth/me`). Unauthenticated requests get
`401 {"detail": "login required"}`; the wrong role gets 403. A session without "Keep me signed in"
is a browser-session cookie that also expires server-side after 12 hours.

## Migrations per module

`alembic.ini` has a named section per module; always pass it:

```bash
alembic -n core upgrade head
alembic -n stock revision --autogenerate -m "items"   # in the feat/stock worktree
alembic -n stock upgrade head
```

Each environment keeps its own version table (`<module>.alembic_version_<module>`) and only
autogenerates objects in its own schema (`migrations/env_helper.py`). Models declare
`__table_args__ = {"schema": "<module>"}`; cross-schema foreign keys such as
`ForeignKey("core.employees.id")` are fine. `app.modules.<module>.models` is imported automatically
by the module's environment once it exists. **Only `main` changes the `core` schema.**

## Tests

```bash
make test
```

The suite uses a real Postgres database: `TEST_DATABASE_URL` or, by default, the main database's
name + `_test_` + the checkout directory (`ttk_test_ttkms`, `ttk_test_ttk_stock`, ...) on the same
server, so worktrees never share a test database. It is created if missing, its schemas are reset,
every enabled module's migrations are run through Alembic, and each test runs in a rolled-back
transaction. `tests/__init__.py` pins `ENABLED_MODULES` to the default set so `.env` cannot change
what the suite asserts; `client_for("stock,attendance,payroll,admin")` builds a stock-enabled app.
The core downgrade/upgrade round-trip test uses a further throwaway database (`..._roundtrip`).

Skipped until their inputs exist: the BS round-trip tests (need the calendar table, below) and the
PDF tests (need pango). The frontend is checked with `make web-lint` and `make web-build`.

## Worktree workflow

Each feature module is built on its own branch in its own worktree, from `main`:

```bash
git worktree add ../ttk-stock      -b feat/stock
git worktree add ../ttk-attendance -b feat/attendance
git worktree add ../ttk-payroll    -b feat/payroll
git worktree add ../ttk-admin      -b feat/admin
```

In every worktree:

1. create its own `.venv` (`pip install -r requirements.txt`) and run `make web-install`;
2. copy `.env` and give it its own ports - `APP_PORT`/`WEB_PORT` 8001/3001 stock, 8002/3002
   attendance, 8003/3003 payroll, 8004/3004 admin - all worktrees share the same database;
3. only touch `app/modules/<name>/`, `migrations/<name>/`, `tests/<name>/` and your module's pages
   and components under `web/` (`web/app/(app)/<name>/`, `web/components/<name>/`);
4. `git rebase main` before merging; merge order: stock, attendance, admin, then payroll.

What a module can rely on from core:

- `Module` / `NavItem` (`app/core/modules.py`): the router is mounted under `/api/<name>`; nav
  items (frontend paths) show in the sidebar for the listed roles via `/api/core/modules`;
  `dashboard_widgets` return `{"kind", "title", "data"}` and the Next.js dashboard renders them by
  `kind` (`web/components/widgets/index.tsx`). All of this only while the module is listed in
  `ENABLED_MODULES`; anything that reaches into another module checks `is_enabled("<name>")`.
- `require_role("admin", "manager")`, `CurrentUser`, `DbSession` dependencies; pydantic schemas
  in `app/core/schemas.py` as the pattern for new endpoints.
- Frontend: `apiFetch` (`web/lib/api.ts`, adds the CSRF header and handles 401), `useSession()`,
  the UI kit in `web/components/ui/` (PageHeader, StatCard, Pill, DataTable, Modal, Segmented,
  BsDateInput, EmptyState, Pagination) and `web/lib/bsdate.ts` helpers.
- Exports: `to_xlsx(title, meta_lines, columns, rows)` and `to_pdf(template, context)`; print
  templates extend `print/base.html`.
- Cross-module data goes through `app/contracts.py` (payroll gets attendance summaries via
  `get_attendance_summary()`; the attendance module calls `register_attendance_summary(...)`).
- `record_audit(db, module=..., action=..., entity=..., entity_id=...)` for the audit log.

## Bikram Sambat dates

`app/core/bsdate.py` implements the API (`ad_to_bs`, `bs_to_ad`, `today_bs`, `days_in_month`,
`month_name`, `weekday_initial`, `to_devanagari_digits`, parse/format) over a month-length table
that must be ported from `static/vendor/nepali.datepicker.v4.min.js`:

```bash
python scripts/port_bs_calendar.py      # writes app/core/bs_calendar_data.py
make test                               # BS round-trip and known-pair tests now run
```

The same vendor file goes into `web/public/vendor/` for the browser date-picker, so server and
browser agree exactly. Until the table exists `/api/today` returns AD only and
`/api/bsdate/convert` answers 503. AD `date` columns are stored in the database; BS is for display.

TODO: BS 2082+ month lengths must be checked against the official government calendar.

## Admin module (feat/admin)

Screens: `/admin/users` (users, per-user access, temporary passwords), `/admin/barcodes`
(Code 128 stickers), `/admin/payment-modes` (Cash + bank / wallet / QR / cheque). Branches &
departments, Settings and the Audit log keep their routes on mock data but are not in the sidebar.

- Roles are Admin / Manager / Staff; a role is only the starting preset. Six switches live in
  `app/modules/admin/permissions.py` (`mark_attendance`, `view_attendance_report`,
  `see_other_branches`, `manage_employees`, `salary_advances`, `manage_users`); overrides are
  stored per user in `admin.user_access`. Guard endpoints with
  `Depends(require_access("manage_users"))` instead of `require_role`.
- Users sign in with their phone number or username (`POST /api/auth/login`, one field). A user
  created or reset by an admin gets a temporary password and must change it
  (`POST /api/auth/change-password`, `/set-password`) before any other call succeeds.
- Payroll reads active payment modes from `GET /api/admin/payment-modes?active=1`; Cash is id 1
  and always on. A mode is never deleted, only turned off.
- Sticker PDFs need WeasyPrint with pango (`brew install pango`); the page prints from the
  browser either way.
