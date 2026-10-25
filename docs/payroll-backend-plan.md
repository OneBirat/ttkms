# People & payroll — backend plan

Status: **not built yet.** The UI under `web/app/people/` runs on the mock client `web/app/people/api.ts`;
every function there is annotated with the endpoint it stands in for and `types.ts` holds the exact
response shapes. This document is the build list for the FastAPI side. It is written to be implemented
*after* ttk-admin's per-user permissions and payment modes are merged, because payments reference
`admin.payment_modes` and every endpoint is gated on a permission switch.

Rules the backend enforces (decided 2026-10-26): no SSF; monthly net = salary − salary ÷ 30 × absent
days + overtime hours × rate − TDS (a fixed 30, whatever the BS month's length; the overtime rate
defaults to salary ÷ 30 ÷ 8 the same way); TDS stays 0 for now (a later decision); daily net = wage × (present + overtime days) + overtime − TDS;
Saturdays paid; advances are part-payments of that month's salary (no recovery, no carry-over); a payment
never exceeds the due; BS dates first; attendance only through `AttendanceSummary.for_month`.

Added 25 Oct 2026 with the attendance backend:
- **Earned so far** (the running month, which also caps advances): salary × min(days_counted, 30) ÷ 30
  − absences so far × salary ÷ 30 + overtime so far (`MonthSummary.days_counted` = today's BS day).
  Past months are never prorated. Daily staff stay pay-as-you-go (wage × days marked).
- **Saturday work – PENDING BUSINESS DECISION**: `payroll.saturday_work_rule` = `overtime_only`
  (default: monthly staff get only the Saturday overtime hours) | `extra_day` (also salary ÷ 30 per
  Saturday worked, inside gross). Daily staff always get the wage + hours. Set on admin Settings ›
  Payroll (`/api/admin/settings/payroll`); see `app/modules/attendance/API_NOTES.md`.
- **Void, never delete** (payroll_0002: `voided_at`, `voided_by`, `void_reason`):
  `POST /payments/{id}/void {reason}` - admin role only, reason required, audit-logged (`void`),
  cannot be undone, a second void is 409 `already_voided`. A voided payment keeps its receipt number
  (never reused) and stays listed - struck through with "Voided — reason" in the month ledger,
  transactions and Payment reports (`show_voided=1`, the "Show voided" toggle, off by default) - but
  counts for nothing: not in paid / due / balances / room / tiles / totals / exports / the
  payments-per-month contract / "Payments today". UI: "Void" on a payment row (desktop register and
  ledger detail) and "Void payment" in the phone payment details sheet, with a reason dialog.
- `POST /payments`: `for_year` / `for_month` may be left out (both or neither) and then default to the
  BS month of the payment date - the attendance scan flow's advances do that.

## 1. Tables (schema `payroll`, Alembic env `migrations/payroll`)

**Employees live in `core.employees` (schema `core`, owned by `main`) - payroll has no employees
table.** Payroll's tables are keyed on `core.employees.id`; its `/employees*` endpoints read and write
the core row (joined with `core.branches` / `core.departments`) and add payroll's own data. Core
already has `id`, `code` (via `core.next_employee_code()`), `full_name`, `phone`, `branch_id`,
`department_id`, `designation`, `status` active|inactive, `photo_path`. The profile fields the UI
needs on top (`full_name_np`, `phone_alt`, `address`, `joined_bs` / `joined_ad`, `user_id` -> the
login, `barcode` = `'TTK-' || replace(code, '-', '')`) are added to `core.employees` by a **core
migration on `main`** when the payroll backend is built; departments are managed through
`/api/core/departments` (done 2026-10-25, see "Departments" below).

```
payroll.salary_history            one row per revision; the latest effective row is the structure in force
  id, employee_id FK, pay_type enum('monthly','daily'), basic int, allowances int default 0,
  ot_rate int NOT NULL (Rs per overtime hour; default basic ÷ days-in-month ÷ 8, daily: wage ÷ 8),
  paid_by enum('cash','bank'), effective_bs char(10), effective_ad date, reason text NULL,
  created_by FK core.users, created_at
  index (employee_id, effective_ad desc)

payroll.payments                  salary and advance part-payments; never above the month's due
  id, receipt_no text UNIQUE ("ADV-0412"/"SAL-0410" = type prefix + zero-padded id),
  employee_id FK, bs_year int, bs_month int, type enum('salary','advance'), amount int CHECK (amount > 0),
  payment_mode_id int NOT NULL FK admin.payment_modes  (Cash = the built-in row, default),
  reference text NULL (bank/cheque), note text NULL,
  date_bs char(10), date_ad date, recorded_by FK core.users, source enum('account','scan'),
  created_at
  index (employee_id, bs_year, bs_month), index (date_ad), index (payment_mode_id)

payroll.photo_tokens              10-minute links the QR code encodes (or keep in the session store)
  token char(32) PK, employee_id FK, expires_at timestamptz
```

Month ledgers, the transaction ledger, balances and report rows are **never stored**: they are computed
from the structure in force, `AttendanceSummary.for_month` and the month's payments
(`ledgerFor` / `getEmployeeLedger` in `web/app/people/api.ts` are the reference derivations;
`web/app/people/_lib/calc.ts` has the unit-tested formulas to port).

Migrations (`migrations/payroll/versions/`):
1. `payroll_0001_salary` — schema `payroll`, enums, `salary_history`, `photo_tokens` (employees stay in core;
   the extra profile columns are a `core_000x` migration on `main`).
2. `payroll_0002_payments` — `payments` with the FK to `admin.payment_modes` (depends on the admin
   migration that creates it; declare it with `depends_on`), receipt_no trigger or app-side generation.

## 2. Cross-module contracts (`app/contracts.py`)

- `MonthSummary` is `days_in_month, present, overtime_days, overtime_hours, absent, weekly_off, paid_days`
  (no late / half / leave; done on main 2026-10-25, `FakeAttendanceSummary` matches). Attendance registers the real one.
- `TodayStatus` per employee (`present | overtime | absent | weekly_off | not_marked`) from
  `GET /api/attendance/today?branch_id=` — payroll calls it for the list screens.
- `MonthBalance`, `PaymentInput`, `PaymentResult` shared with attendance's scan pop-up
  (`bs_year` / `bs_month` + `payment_mode_id`).
- Payment modes: read-only here through admin's service (`list_payment_modes(active=True)`), never a
  direct table write.

## 3. Endpoints (`/api/payroll`, JSON, snake_case; shapes = `web/app/people/types.ts`)

Permission column = the per-user switch from ttk-admin (role presets: Admin everything, Manager one
branch, Staff mark attendance only). "Own branch" means managers only see employees of their branch.

| Method | Path | Request → Response | Permission |
|---|---|---|---|
| GET | /employees?branch_id&with=today,balance | → `EmployeeListRow[]` (employee, pay_type, rate, today, balance_due) | people.view (own branch) |
| GET | /employees/{id} | → `Employee` | people.view |
| GET | /employees/by-barcode/{barcode} | → `Employee` (attendance scanner) | attendance.mark |
| GET | /employees/next-code | → `{code, barcode}` | people.edit |
| POST | /employees | `EmployeeIn` → `{employee, one_time_password}`; 409+field duplicate phone / username, 422+field | people.edit |
| PATCH | /employees/{id} | `EmployeeUpdateIn` → `Employee` | people.edit |
| PUT | /employees/{id}/photo | multipart `image` (jpeg/png ≤ 5 MB, server re-encodes to 512px JPEG) → `Employee` | people.edit |
| DELETE | /employees/{id}/photo | → `Employee` (photo_url null) | people.edit |
| GET | /employees/{id}/salary | → `{current, history}` | people.view |
| POST | /employees/{id}/salary | `SalaryRevisionIn` → `SalaryStructure` | salary.edit |
| GET | /employees/{id}/attendance?bs_year&bs_month | → `{employee_id, month, summary: MonthSummary}` | people.view |
| GET | /employees/{id}/ledger | → `MonthLedger[]` newest first, from joining month | people.view |
| GET | /employees/{id}/ledger/{YYYY-MM} | → `MonthLedger` | people.view |
| GET | /employees/{id}/transactions | → `EmployeeLedger` (entries oldest first + totals) | people.view |
| GET | /employees/{id}/summary | → `AccountSummary` (earned so far, paid, room, salary month/net/paid/due, recent, balance) | people.view |
| GET | /employees/{id}/payslips/{YYYY-MM}.pdf | → PDF (core.export.to_pdf) | people.view |
| GET | /employees/{id}/ledger.xlsx | → Excel | people.view |
| GET | /months | → `BsMonth[]` newest first (months with payroll data) | people.view |
| GET | /balance?employee_id&bs_year&bs_month | → `MonthBalance` (cross-module, scan pop-up) | payments.record |
| POST | /payments | `PaymentInput` → `PaymentResult`; 422+field: amount 0 / above due / future month / future date / mode inactive or not set up for the type | payments.record |
| GET | /payments?from_bs&to_bs&type&employee_id&branch_id&department_id&sort | → `PaymentsRegister` (rows in `sort` order: date \| branch \| department \| employee \| amount; settlement-month totals, by_employee, by_department and by_branch scoped to `branch_id` / `department_id`; `branch_id` omitted = all branches, forced to the user's own branch without `see_other_branches`) | payments.view |
| GET | /payments/{id}/receipt.pdf | → PDF | payments.view |
| GET | /payments/export.xlsx?from_bs&to_bs&type&q&branch_id&department_id&sort | → Excel: sheets Payments (Department + Branch columns inside the autofilter) / By branch (all branches only) / By department / By employee / Summary / Sort & filter, SUM / SUBTOTAL formulas (layout = `registerWorkbook` in `_lib/exports.ts`, design PaymentsExportExcel) | payments.view |
| GET | /payments/export.pdf?from_bs&to_bs&type&q&branch_id&department_id&sort | → A4 landscape PDF titled "Payment report · {Branch or All branches} · {Department if any} · {range}": tiles, rows grouped per branch / department (nested with all branches) with Salary · Advances · Total subtotals, salary / advance / total footer, still due, signatures (`registerPdfHtml`, design PaymentsExportPdf) | payments.view |
| GET | /report/{YYYY-MM}?department_id&branch_id | → `SalaryReport` (rows, totals, trend, by_department follow the branch; by_branch = staff / net / paid / due per branch; `branch_id` omitted = all branches, forced to the user's own branch without `see_other_branches`) | salary.view |
| GET | /report/{YYYY-MM}.xlsx, .pdf?department_id&branch_id | → file (Branch column + By branch summary with all branches; title "Salary report · {Branch or All branches} · {Department if any} · {month}") | salary.view |
| POST | /photo-tokens | `{employee_id}` → `PhotoToken` (10 min) | people.edit |
| GET | /photo-tokens/{token} | → `PhotoTokenInfo`; 410 when expired; no session | public (token) |
| POST | /photo-tokens/{token}/photo | multipart image, no session → `Employee` | public (token) |

Also used by the Add-employee popup (core): `GET/POST /api/core/branches` (still to build) and the
departments API below.

### Departments (core, built 2026-10-25)

`/api/core/departments` on `main`: `GET` (every department A-Z with `employee_count` incl. former staff
and `active_employee_count`; any signed-in user), `POST {name}` -> 201, `PATCH /{id} {name}`,
`DELETE /{id}` -> 204. Writes need `manage_employees`. Names are trimmed and unique case-insensitively
company-wide (`409 {code: "duplicate_name"}`); delete answers `409 {code: "department_in_use", count,
inactive_count}` while any employee references it (the FK is `ON DELETE RESTRICT`); add / rename /
delete write `core.audit_log` rows. `core.departments.is_active` is kept but ignored by the API.
Payroll's `POST /employees` validates `department_id` against this table.
Needed from ttk-admin: `GET /api/admin/payment-modes?active=1` → `PaymentMode[]`
(`id, type, name, details, use_salary, use_advance, active`). Needed from ttk-attendance:
`GET /api/attendance/today?branch_id=` → `{date, statuses}`.

### Validation details
- `POST /payments`: load the month ledger, `due = max(0, net − Σ payments)`; reject `amount > due`
  with `422 {"detail": "More than the balance due (Rs X).", "field": "amount"}`. Advances against the
  running month use net *so far* (attendance up to today). Reference is kept only for bank / cheque modes.
- `receipt_no` is assigned in the same transaction as the insert.
- Exports take the BS range inclusive; convert to AD with `app/core/bsdate.py`; reject `from > to` with 422.
- Settlement month for register totals: previous BS month while any employee still has due for it,
  otherwise the running month (same rule as the mock's `settlementMonth`).

## 4. Exports via `app/core/export.py`
- `to_xlsx(title, meta_lines, columns, rows)` covers single sheets; add a small multi-sheet helper
  (`to_workbook([...sheets])`) with `ws.auto_filter.ref` and formula cells, or build an `openpyxl`
  Table ("tblPayments") for the Sort & filter sheet.
- `to_pdf(template, context)` with WeasyPrint; templates `payroll/register.html`, `payroll/payslip.html`,
  `payroll/receipt.html` in `app/core/templates/`; `@page { size: A4 landscape }` for the register.

## 5. Order of work
1. Contracts + fake update (attendance shape, today status, payment-mode read service).
2. Models + migrations 0001/0002; `app/modules/payroll/{models,schemas,services,routes}.py`.
3. Employees + salary history + photo endpoints; swap `api.ts` employee functions to `apiFetch`.
4. Ledger / balance / payments / summary / transactions; swap the rest of `api.ts`.
5. Exports (register xlsx/pdf, payslip, receipt, report).
6. Tests under `tests/payroll/` (rules from `calc.test.mjs` ported to pytest; register totals; payment caps).
