# Attendance backend plan

Written 25 Oct 2026 in the `ttk-attendance` worktree after the final-design UI pass. The frontend
(`web/components/attendance/`) runs on the mock in `api.ts`; every shape below already exists in
`web/components/attendance/types.ts` and is exercised by the node tests in
`web/components/attendance/__tests__/`. The backend pass implements the same shapes in FastAPI so
the mock can be swapped for `apiFetch` calls one function at a time.

Rules the backend enforces (decided 24 Oct 2026): a day's status is only **P** present, **O**
overtime (present + whole hours 1–12) or **A** absent; Saturday is the weekly off (**W**, no record
needed); "not marked" (**N**) means no record; paid days = P + O + W; overtime hours are paid on top
by payroll. Dates are stored as BS text and AD date; the AD date is the key.

## 1. Table and migration

Schema `attendance`, module-owned (cross-schema FKs to `core` only, per `app/core/models.py`).

```sql
CREATE SCHEMA IF NOT EXISTS attendance;

CREATE TABLE attendance.records (
  id          bigserial PRIMARY KEY,
  employee_id integer     NOT NULL REFERENCES core.employees(id) ON DELETE RESTRICT,
  date_bs     char(10)    NOT NULL,                        -- "2083-07-08"
  date_ad     date        NOT NULL,
  status      char(1)     NOT NULL CHECK (status IN ('P', 'O', 'A')),
  ot_hours    smallint    NOT NULL DEFAULT 0 CHECK (ot_hours BETWEEN 0 AND 12),
  note        varchar(200) NOT NULL DEFAULT '',
  marked_by   integer     NULL REFERENCES core.users(id) ON DELETE SET NULL,
  marked_via  varchar(6)  NOT NULL CHECK (marked_via IN ('manual', 'scan', 'bulk')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT records_hours_match_status CHECK ((status = 'O') = (ot_hours > 0)),
  CONSTRAINT records_one_per_day UNIQUE (employee_id, date_ad)
);
CREATE INDEX records_date_ad_idx ON attendance.records (date_ad);
CREATE INDEX records_employee_date_idx ON attendance.records (employee_id, date_ad);
```

- `app/modules/attendance/models.py`: `Record` mapped to the table above (`__table_args__` with the
  two CHECKs, the UNIQUE and `{"schema": "attendance"}`), `MarkedVia` enum, relationships to
  `core.Employee` / `core.User` with `lazy="selectin"`.
- Migration `migrations/attendance/versions/attendance_0001_records.py` (`revision = "attendance_0001"`,
  `down_revision = None`); `migrations/attendance/env.py` already uses `env_helper` with its own
  version table, so `alembic -n attendance upgrade head` only touches this schema. `downgrade()`
  drops the table and the schema.
- Setting `attendance.weekly_off` (default `6`) read through `core.settings`; the existing seeded
  `weekly_off: ["sat"]` is mapped to the weekday number in one helper (`weekly_off_weekday()`).

## 2. Permissions

Core only has roles today (`admin`, `manager`, `store_keeper`, `staff`; `require_role` in
`app/core/auth.py`). The module defines three permissions and derives them from the role until a
permissions table exists on main:

| Permission | admin | manager | store_keeper / staff |
|---|---|---|---|
| `mark_attendance` – mark, bulk-mark, scan, lookup, day list, employee month | ✓ | ✓ (own branch) | – |
| `view_attendance_report` – report, exports, employee month | ✓ | ✓ (own branch) | – |
| `see_other_branches` – pick any branch in `/day`, `/report`, exports; `branches` lists them all | ✓ | – | – |

`app/modules/attendance/permissions.py`: `require_permission(name)` dependency returning the user,
and `branch_scope(user, requested_branch)` which returns the requested branch for
`see_other_branches`, else the user's own branch (users get `branch_id` from their employee row;
an admin without one defaults to the first branch). Every endpoint goes through `branch_scope`, so
a manager never sees another branch even with a hand-edited query string. The module stays limited
to `ROLES = {"admin", "manager"}` at the router level as now.

## 3. Endpoints (`/api/attendance`, session cookie, `X-CSRF-Token` on POST)

Pydantic models in `app/modules/attendance/schemas.py`, named after `types.ts`. Service functions in
`services.py`; routers in `routes.py`. Each row below names the frontend call it replaces.

| Endpoint | Frontend call | Permission | Behaviour |
|---|---|---|---|
| `GET /day?date_bs=&branch=` | `getDay` | `mark_attendance` | 422 for a bad BS date or a future day. Returns `DayAttendance {day, settings, branches, departments, rows: [{employee, record \| null}]}` for every **active** employee of the branch, ordered by department then name. `branches` carry headcounts (admins see all, others their own). |
| `POST /mark` | `markOne` | `mark_attendance` | Body `MarkOneRequest {date_bs, employee_id, status, ot_hours, note?}`. Validates hours (`O` → 1–12, else 0), the day (not future, valid BS), the employee (active, in scope). Upsert on `(employee_id, date_ad)` with `ON CONFLICT DO UPDATE`; returns `MarkOneResponse {record, previous}` where `previous` is the old status or `"N"`. `marked_via = "manual"`, `marked_by = user.id`. |
| `POST /bulk-mark` | `bulkMarkPresent` | `mark_attendance` | Body `BulkMarkRequest {date_bs, branch_id, employee_ids? \| department_id?}` (422 when neither). One transaction: select the scope's active employees **without a record that day** `FOR UPDATE SKIP LOCKED`, insert `P` rows with `marked_via = "bulk"`, return `BulkMarkResponse {marked: [{employee_id, name}], skipped: [ids that already had a record], records}`. Never updates an existing record. |
| `POST /mark` with `status: "O"` | `saveOvertime` (desktop pop-up, phone sheet, ⋮ menu) | `mark_attendance` | Same endpoint; overtime is just a mark with hours. Changing hours later is another upsert. |
| `GET /lookup?code=` | `lookupCode` | `mark_attendance` | Normalises `TTK-E004 / E-004 / E004 / 4` to the employee code (`normalizeCode` in helpers.ts has the rules and tests to mirror); 404 when no active employee in scope matches. Returns `LookupResponse {code, employee, today}`. |
| `POST /scan` | `scanMark` | `mark_attendance` | Body `ScanRequest {code, action: present \| overtime, ot_hours}`; upserts **today** with `marked_via = "scan"`; returns `ScanResponse {employee, record}`. |
| `GET /employees/{id}/month?bs_year=&bs_month=` | `getEmployeeMonth` | `mark_attendance` or `view_attendance_report` | `EmployeeMonth {employee, month, cells[], totals, payments[]}`: one cell per BS day (`W` for a Saturday without a record, `N` for no record), `advance` / `salary` rupees from payroll's payments that day, `payments` = payroll history of the month (newest first). Future months → 404. |
| `GET /report?bs_year=&bs_month=&branch=` | `getReport` | `view_attendance_report` | `MonthReport {month, settings, branches, departments, rows, generated_at}`; `rows` for the branch's active employees with per-day cells and `AttendanceTotals` (present, overtime_days, overtime_hours, absent, weekly_off, not_marked, marked_days, attended, paid_days). Week, day and department views are sliced in the browser. |
| `GET /report/export.xlsx?bs_year=&bs_month=&branch=&dept=&q=&sort=` | `exportReport("xlsx")` | `view_attendance_report` | openpyxl via `app/core/export.py`; sheets **Summary / Daily grid / By department**, columns Emp ID, Name, Department, days, `P O A W Paid`; cells `✓`, overtime hours (number), `A`, `–`; the Daily grid freezes 4 rows and ends with the Staff-present row. Mirrors `xlsx.ts` (tests there list the exact rows). |
| `GET /report/export.pdf?…&hide_saturdays=0\|1` | `exportReport("pdf")` | `view_attendance_report` | WeasyPrint template `app/modules/attendance/templates/report.html` with the CSS of `print.ts`: A4 landscape, 5 boxes, `P O A W Paid` columns (widths days 24, P 26, O 30, A 24, W 24, Paid 34 px; name auto), Saturdays merged per department run into a vertical red "SATURDAY" band (rowspan recomputed per page: 20 rows on page 1, 27 after), `hide_saturdays=1` drops the Saturday columns and adds "· Saturdays hidden". `saturdaySpans` in `print.ts` is the reference for the merge. |
| `GET /status?date_bs=&employee_ids=` | payroll screens ("today status") | signed-in attendance or payroll user | `[{employee_id, status: P \| O \| A \| W \| N, ot_hours}]`; `date_bs` defaults to today. Payroll also gets `AttendanceSummary.for_month` in-process (section 5). |

Common rules: every write stamps `marked_by`; the `attendance_today` widget and `GET /day` read the
same `day_rows(branch, date)` service; BS ↔ AD through `app.core.bsdate` (same table the browser's
`bsdate.ts` uses, so Ashwin 2083 keeps 31 days on both sides); all list endpoints are limited to
`core.employees.status = 'active'`.

Error shape: `ErrorOut {detail}` as core does; 422 messages are the ones the mock throws today
("Overtime needs 1–12 hours", "… is not a valid BS date.", "Give employee_ids or a department_id.").

## 4. Reading payments for the report and the record sheet

The month report's cells and `EmployeeMonth` need advance / salary amounts per day. Call payroll's
service in-process (`app.modules.payroll.services.payments_for_month(employee_ids, bs_year,
bs_month)` – to be agreed with the payroll worktree) and fold the amounts into the cells
(`advance`, `salary`), exactly as `monthCells()` does in the mock. Until that service exists the
cells simply omit the two fields and the UI shows no badges.

## 5. Payroll contract and today status

- `MonthSummary` in `app/contracts.py` is already `days_in_month, present, overtime_days,
  overtime_hours, absent, weekly_off, paid_days` (main, 2026-10-25); register the real `AttendanceSummary` at
  module import (`register_attendance_summary`). Implementation: BS month → AD range, one query
  over `attendance.records`, count statuses, `weekly_off` = Saturdays without a record,
  `paid_days = present + overtime_days + weekly_off`. The frontend's `computeTotals` /
  `paidDays` tests in `helpers.test.ts` are the fixtures to mirror in `tests/attendance/`.
- `GET /status` above gives payroll's pages today's status without importing attendance models.

## 6. Dashboard widget

Replace `SAMPLE_TODAY` in `app/modules/attendance/__init__.py` with `day_rows(branch, today)`
counts: `total`, `present`, `overtime`, `overtime_hours`, `absent`, `not_marked`, `not_in` (A or N
rows with name and status, capped at 8), `mark_path`. Branch = `branch_scope(user, None)`.

## 7. Frontend switch-over

`web/components/attendance/api.ts`: replace each mock body with `apiFetch` to the path in the
table, keeping the exported function names and types. Order that keeps the app usable at every
step: `getToday` (core) → `getDay` / `markOne` / `bulkMarkPresent` → `lookupCode` / `scanMark` →
`getReport` / `getEmployeeMonth` → exports (switch `exportReport` to a plain download of the
server file) → payroll client (`getMonthBalance`, `recordPayment`, `getPaymentHistoryFor`) when
payroll ships its endpoints. The mock store stays behind an env flag for the node tests.

## 8. Tests (`tests/attendance/`)

- Mark: upsert replaces status and reports `previous`; hours validation; future day 422; branch
  scope 404 for a manager marking another branch.
- Bulk: only unmarked employees written, `skipped` lists the rest, one transaction (fail one row →
  nothing written), department vs explicit ids scopes.
- Scan / lookup: every code shape; inactive employee 404; `marked_via`.
- Report: totals per row match the frontend fixtures; `W` for Saturdays; `branch` scoping;
  `branches` list by permission.
- Employee month: cells, totals, payments folded in.
- Exports: xlsx sheet names and header row; PDF HTML contains the `SATURDAY` band with the right
  rowspan on a 2-page sample and no Saturdays with `hide_saturdays=1`.
- Widget: counts from a seeded day. Contract: `MonthSummary` matches `computeTotals`.

## 9. Order of work

1. Migration + model + settings helper (0.5 d).
2. Permissions helper + `GET /day`, `POST /mark`, `POST /bulk-mark` + tests (1 d).
3. `GET /lookup`, `POST /scan`, widget (0.5 d).
4. `GET /report`, `GET /employees/{id}/month`, `GET /status`, `MonthSummary` change on main (1 d).
5. Exports (xlsx + WeasyPrint template) (1 d).
6. Frontend switch-over function by function, mock kept for tests (0.5 d).

## Needs from other worktrees

- **main** (all done 2026-10-25): `MonthSummary` shape change in `app/contracts.py`; per-user
  permissions and `branch_id` via `/api/auth/me` (`useSession().branchId`, `can(...)`); `GET /api/today`
  (with `counts` for the dashboard stat row).
- **payroll**: `payments_for_month` service (section 4) and the three payroll endpoints the scan
  flow calls (`API_NOTES.md`, payroll client section).
