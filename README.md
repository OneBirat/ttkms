# TTK

Attendance and payroll for a kitchen-appliance business in Nepal.

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

## Stock module (removed)

The stock module was paused on 2026-10-24 and taken out of the app on 2026-10-25: `stock` is no
longer a known module name (`KNOWN_MODULES` in `app/config.py`), there is no stock code under
`app/modules/` or `web/`, and the admin "Stock" settings group is gone. Its full code stays on
branch `feat/stock` (tag `stock-paused-2026-10-24`). The `stock` Postgres schema, its tables and
`migrations/stock/` are **kept untouched** (`alembic.ini` still has a `[stock]` section); `make
migrate` never touches them because the module is not enabled. To bring stock back: merge the
branch, add `stock` to `KNOWN_MODULES`, `DEFAULT_ENABLED_MODULES` and `ENABLED_MODULES`, and run
`alembic -n stock upgrade head`.

Code outside a module that touches another module must guard with `is_enabled(<name>)`
(`app/core/modules.py`); the test-suite builds an app with another module set through the
`client_for` fixture (`tests/conftest.py`), e.g. `async with client_for("attendance,admin")`.

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
  contracts.py     cross-module interfaces (AttendanceSummary, PayrollPayments + fakes + registries)
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
    attendance/ payroll/ admin/          each exports `module = Module(...)`, mounted at /api/<name>
                                         when listed in ENABLED_MODULES
web/               Next.js app: app/ (routes), components/ (shell + ui/), lib/ (api, session, bsdate)
static/            css/print.css and vendor/fonts for PDFs
scripts/           gen_bs_calendar.py (exports the BS calendar table to web/lib/bs/calendar-data.json)
migrations/        env_helper.py + <module>/env.py + <module>/versions/
tests/             conftest.py, core/, attendance/, payroll/, admin/
```

## API in one minute

```bash
curl -c jar -b jar localhost:8000/api/auth/csrf                      # {"csrf_token": ...}
curl -c jar -b jar -H "X-CSRF-Token: <token>" -H 'Content-Type: application/json' \
     -d '{"username":"admin","password":"...","remember":true}' localhost:8000/api/auth/login
curl -b jar localhost:8000/api/auth/me          # {"user": {...}, "csrf_token": ...}
curl -b jar localhost:8000/api/core/modules     # {"enabled": [...], "nav": [...]} for the sidebar
curl -b jar localhost:8000/api/core/departments # [{id, name, employee_count, active_employee_count}];
                                                # POST / PATCH /{id} / DELETE /{id} need manage_employees
curl -b jar localhost:8000/api/registry         # enabled modules + nav filtered to the user's role
curl -b jar localhost:8000/api/dashboard        # widgets: attendance_today, payments_today
curl -b jar localhost:8000/api/today            # AD + BS date for the header; with a session also
                                                # "counts" (present/overtime/absent/not marked/paid
                                                # today) for the dashboard stat row
```

Every POST/PUT/PATCH/DELETE needs the `X-CSRF-Token` header (the token comes back from
`/api/auth/csrf`, `/api/auth/login` and `/api/auth/me`). Unauthenticated requests get
`401 {"detail": "login required"}`; the wrong role gets 403. A session without "Keep me signed in"
is a browser-session cookie that also expires server-side after 12 hours.

## Tests

```bash
make test
```

The suite uses a real Postgres database: `TEST_DATABASE_URL` or, by default, the main database's
name + `_test_` + the checkout directory (`ttk_test_ttkms`, `ttk_test_ttk_admin`, ...) on the same
server, so worktrees never share a test database. It is created if missing, its schemas are reset,
every enabled module's migrations are run through Alembic, and each test runs in a rolled-back
transaction. `tests/__init__.py` pins `ENABLED_MODULES` to the default set so `.env` cannot change
what the suite asserts; `client_for("attendance,admin")` builds an app with another module set.
The core downgrade/upgrade round-trip test uses a further throwaway database (`..._roundtrip`).

Skipped until their inputs exist: the BS round-trip tests (need the calendar table, below) and the
PDF tests (need pango). The frontend is checked with `make web-lint` and `make web-build`.

## Worktrees

`main` lives in this checkout (`ttkms`). Each module is developed on its own branch in a sibling
worktree and merged back to `main`:

| Worktree | Branch | Owns | `APP_PORT` / `WEB_PORT` |
|---|---|---|---|
| `ttkms` | `main` | core (`app/core`, `migrations/core`, `web/components`, `web/lib`, contracts) | 8000 / 3000 |
| `../ttk-attendance` | `feat/attendance` | `app/modules/attendance`, `migrations/attendance`, `tests/attendance`, `web/app/(app)/attendance`, `web/components/attendance` | 8002 / 3002 |
| `../ttk-payroll` | `feat/payroll` | `app/modules/payroll`, `migrations/payroll`, `tests/payroll`, `web/app/people` | 8003 / 3003 |
| `../ttk-admin` | `feat/admin` | `app/modules/admin`, `migrations/admin`, `tests/admin`, `web/app/(app)/admin`, `web/components/admin` | 8004 / 3004 |

```bash
git worktree add ../ttk-attendance feat/attendance
git worktree add ../ttk-payroll    feat/payroll
git worktree add ../ttk-admin      feat/admin
```

Setting up a worktree: create its own `.venv` (`pip install -r requirements.txt`), run
`make web-install`, copy `.env` from `main` and give it the ports above. Everything else is
shared: `git rebase main` before merging, and only `main` changes `app/core`, `migrations/core` and
the shared frontend (`web/components`, `web/lib`).

### One database, one Alembic section per module

Every worktree points `DATABASE_URL` at the same Postgres (`localhost:5433`, database `ttk`, from
`docker-compose.dev.yml`). Each module owns one Postgres schema and one Alembic section in
`alembic.ini` with its own script directory and version table, so worktrees never migrate each
other's tables:

| Section | Schema | Scripts | Version table |
|---|---|---|---|
| `core` | `core` | `migrations/core/` | `core.alembic_version_core` |
| `admin` | `admin` | `migrations/admin/` | `admin.alembic_version_admin` |
| `attendance` | `attendance` | `migrations/attendance/` | `attendance.alembic_version_attendance` |
| `payroll` | `payroll` | `migrations/payroll/` | `payroll.alembic_version_payroll` |

```bash
make migrate                                         # core, then admin, then every other enabled module
alembic -n attendance revision --autogenerate -m "records"   # in the module's worktree
alembic -n attendance upgrade head
```

The sections depend on each other through cross-schema foreign keys, so when you run them by
hand keep this order: **core → admin → attendance / payroll**. `payroll_0001` references
`admin.payment_modes` (admin_0002) and the profile columns of `core_0006`; it refuses to run with a
clear message when either is missing. Alembic's `depends_on` cannot express this across separate
environments, which is why `make migrate` and the test-suite order the sections themselves.

Only the module's own schema is autogenerated (`migrations/env_helper.py`); cross-schema foreign
keys such as `ForeignKey("core.employees.id")` are fine. Models declare
`__table_args__ = {"schema": "<module>"}`; `app.modules.<module>.models` is imported by the
module's environment once it exists.

### Running a worktree

```bash
make dev          # uvicorn app.main:app --reload --port $APP_PORT
make web-dev      # next dev --port $WEB_PORT, /api proxied to http://localhost:$APP_PORT
```

Open `http://localhost:$WEB_PORT` and sign in there. `make web-build` is the production build;
stop that worktree's `next dev` first (both use `web/.next`).

### Testing a worktree

```bash
make test         # pytest, then the web tests when web/node_modules exists
make lint         # ruff check + format check, eslint, tsc --noEmit
make web-test     # node --test over web/**/*.test.{ts,tsx,mjs} (web/test/README.md)
```

pytest uses a database of its own per checkout (`ttk_test_<directory>`, see Tests above), so
worktrees never share test data. `tests/__init__.py` pins `ENABLED_MODULES` to the default set;
`client_for("attendance,admin")` builds an app with another module set.

### What a module can rely on from core

- `Module` / `NavItem` (`app/core/modules.py`): the router is mounted under `/api/<name>`; nav
  items (frontend paths) show in the sidebar for the listed roles via `/api/core/modules`;
  `dashboard_widgets` return `{"kind", "title", "data"}` and the Next.js dashboard renders them by
  `kind` (`web/components/widgets/index.tsx`). All of this only while the module is listed in
  `ENABLED_MODULES`; anything that reaches into another module checks `is_enabled("<name>")`.
- `require_role("admin", "manager")`, `CurrentUser`, `DbSession` dependencies; pydantic schemas
  in `app/core/schemas.py` as the pattern for new endpoints.
- Frontend: `apiFetch` (`web/lib/api.ts`, adds the CSRF header and handles 401), `useSession()`,
  the UI kit in `web/components/ui/` (PageHeader, StatCard, Pill, DataTable, Modal, Segmented,
  EmptyState, Pagination), the date components in `web/components/date/` and `web/lib/bs`.
- Exports: `to_xlsx(title, meta_lines, columns, rows)` and `to_pdf(template, context)`; print
  templates extend `print/base.html`.
- Cross-module data goes through `app/contracts.py`: payroll gets attendance summaries via
  `get_attendance_summary()` (attendance calls `register_attendance_summary(...)`); attendance
  records scan payments and lists a month's payments via `get_payroll_payments()` (payroll calls
  `register_payroll_payments(...)`). Both have deterministic fakes until the real service registers.
- `record_audit(db, module=..., action=..., entity=..., entity_id=...)` for the audit log.

## Bikram Sambat dates

`app/core/bsdate.py` (backend) and `web/lib/bs` (frontend) implement the same calendar
(`ad_to_bs`, `bs_to_ad`, `today_bs`, `bs_month_range`, `fiscal_year`, `format_bs`, ...) over one
month-length table, `web/lib/bs/calendar-data.json`, generated from the `nepali-datetime` package
by `scripts/gen_bs_calendar.py`; official corrections go into `web/lib/bs/calendar-overrides.json`.
See `docs/bs-calendar.md`. Timestamps are stored in UTC, calendar days as AD `date` columns; today
and day boundaries are always taken in Asia/Kathmandu. APIs accept `date` (AD) or `date_bs` and
return both. The date pickers live in `web/components/date` (demo at `/dev/date-picker`).

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
