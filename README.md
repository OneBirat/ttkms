# TTK

Stock, attendance and payroll for a kitchen-appliance business in Nepal.

Backend: Python 3.12, FastAPI, SQLAlchemy 2 (async, asyncpg), Alembic, PostgreSQL 16, argon2 session
auth, openpyxl (Excel) and WeasyPrint (PDF). One database (`ttk`) with one Postgres schema per
module - `core`, `stock`, `attendance`, `payroll`, `admin` - and one Alembic environment per module.

## Setup

```bash
/opt/homebrew/bin/python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env            # set DATABASE_URL password, SECRET_KEY, APP_PORT
brew install pango              # native libraries for WeasyPrint (PDF export)
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
make migrate                    # core first, then every module that has migrations
make seed                       # branches, departments, 5 employees, settings, admin user
make dev                        # uvicorn --reload on $APP_PORT -> http://localhost:8000
```

`make seed` / `python -m app.cli create-admin` read `ADMIN_USERNAME` / `ADMIN_PASSWORD` from `.env`
when set, otherwise they prompt. Both commands are idempotent.

| Make target | What it does |
|---|---|
| `make dev` | `uvicorn app.main:app --reload --port $APP_PORT` |
| `make migrate` | `alembic -n core upgrade head`, then each module with versions |
| `make test` | pytest (creates and migrates the `ttk_test` database itself) |
| `make lint` / `make fmt` | ruff check + format check / auto-format |
| `make seed` / `make create-admin` | `python -m app.cli seed` / `create-admin` |

## Project layout

```
app/
  main.py          app factory: middleware, static files, error handlers, module loading
  config.py        pydantic-settings (reads this worktree's .env)
  db.py            async engine, get_db dependency, declarative Base
  cli.py           create-admin, seed
  contracts.py     cross-module interfaces (AttendanceSummary + fake + registry)
  core/
    models.py      users, branches, departments, employees, settings, audit_log  (schema core)
    auth.py        /login, /logout, CurrentUser, require_role(...)
    csrf.py        per-session CSRF token (hidden input or X-CSRF-Token header)
    sessions.py    session cookie with "Keep me signed in"
    bsdate.py      Bikram Sambat calendar API (data table pending - see below)
    export.py      to_xlsx(...), to_pdf(...)
    modules.py     Module / NavItem registry
    routes.py      dashboard, /core/export-demo.pdf|.xlsx
    services.py    settings store, audit log, normalised-name lookups
    templates/     base.html, login.html, dashboard.html, partials/, macros/, print/
  modules/
    stock/ attendance/ payroll/ admin/   each exports `module = Module(...)`
static/            css/app.css (design tokens), js/app.js, vendor/ (htmx, fonts, date-picker)
migrations/        env_helper.py + <module>/env.py + <module>/versions/
tests/             conftest.py, core/, stock/, attendance/, payroll/, admin/
```

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
name + `_test` (`ttk_test`) on the same server. It is created if missing, its schemas are reset, the
core migrations are run through Alembic, and each test runs in a rolled-back transaction. When two
worktrees run tests at the same time give each its own `TEST_DATABASE_URL`.

Skipped until their inputs exist: the BS round-trip tests (need the calendar table, below) and the
PDF tests (need pango).

## Worktree workflow

Each feature module is built on its own branch in its own worktree, from `main`:

```bash
git worktree add ../ttk-stock      -b feat/stock
git worktree add ../ttk-attendance -b feat/attendance
git worktree add ../ttk-payroll    -b feat/payroll
git worktree add ../ttk-admin      -b feat/admin
```

In every worktree:

1. create its own `.venv` and `pip install -r requirements.txt`;
2. copy `.env` and give it its own `APP_PORT` (8001 stock, 8002 attendance, 8003 payroll, 8004
   admin) - all worktrees share the same database;
3. only touch `app/modules/<name>/`, `migrations/<name>/` and `tests/<name>/`;
4. `git rebase main` before merging; merge order: stock, attendance, admin, then payroll.

What a module can rely on from core:

- `Module` / `NavItem` (`app/core/modules.py`): the router is mounted under `/<name>`, nav items
  show in the sidebar for the listed roles, `dashboard_widgets` render on `/` in order.
- `require_role("admin", "manager")`, `CurrentUser`, `DbSession` dependencies.
- CSRF: forms include `<input type="hidden" name="csrf_token" value="{{ csrf_token }}">`; HTMX
  requests already carry the `X-CSRF-Token` header (set on `<body>`).
- Templates: put them under `app/modules/<name>/templates/<name>/` and use the shared macros
  (`page_header`, `stat_card`, `pill`, `data_table`, `modal`, `segmented`, `bs_date_input`,
  `empty_state`, `pagination`) and filters (`|bs`, `|bs_np`, `|bs_long`, `|np_digits`).
- Exports: `to_xlsx(title, meta_lines, columns, rows)` and `to_pdf(template, context)`.
- Cross-module data goes through `app/contracts.py` (payroll gets attendance summaries via
  `get_attendance_summary()`; the attendance module calls `register_attendance_summary(...)`).
- `record_audit(db, module=..., action=..., entity=..., entity_id=...)` for the audit log.

## Bikram Sambat dates

`app/core/bsdate.py` implements the API (`ad_to_bs`, `bs_to_ad`, `today_bs`, `days_in_month`,
`month_name`, `weekday_initial`, `to_devanagari_digits`, parse/format) over a month-length table
that must be ported from `static/vendor/nepali.datepicker.v4.min.js` into
`app/core/bs_calendar_data.py` (`BS_MONTH_DAYS`, `ANCHOR_BS`, `ANCHOR_AD`), so the server and the
browser date-picker agree exactly. Until that file exists the UI shows AD dates and the conversion
tests are skipped. AD `date` columns are stored in the database; BS is for display.

TODO: BS 2082+ month lengths must be checked against the official government calendar.
