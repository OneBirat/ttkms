# Attendance – API notes

Built 25 Oct 2026 (tag `payroll-backend-done` + the attendance backend commits). The web screens call
these through `web/components/attendance/api.ts`; `web/components/attendance/types.ts` mirrors
`app/modules/attendance/schemas.py` field for field. The node tests run on the in-memory twin
`web/components/attendance/mock/mockApi.ts`. Code: `models.py` (tables), `access.py` (permissions,
branch scope), `services.py` (marking rules), `report.py` (report, employee month, dots),
`contract.py` (AttendanceSummary), `routes.py`, `__init__.py` (sidebar, dashboard).

## Rules

- A day is only `P` present, `O` overtime (present + whole hours 1–12) or `A` absent. Not marked = no row.
- **Saturday is the weekly off (`W`)**: computed, never stored. A Saturday row means the person came in:
  `P` or `O` are stored, `A` is refused (422), bulk Present is refused on a Saturday.
- The attendance day is an **AD date in Asia/Kathmandu** (`services.today()`; 23:59 there is still
  today, 00:01 is tomorrow). Future days are never writable (422 "Attendance cannot be marked for a
  future day."). Every mark saves at once.
- Employees come only from `core.employees`. Only **active** employees who have joined by that day can
  be marked (404 / 422); inactive staff keep their history and appear in the months they worked.
- Every insert, change and clear writes `attendance.record_changes` (old → new status / hours / note,
  who, when); a save that changes nothing writes nothing.

## Permissions (app/modules/admin/permissions.py)

`mark_attendance` – day list, mark / change / clear, bulk, scan, lookup, marked-day dots, employee month.
`view_attendance_report` – the month report (Staff get 403 unless it is switched on for them).
The employee month (phone calendar) takes either. Without `see_other_branches` every call is scoped
to the user's own branch (`admin.user_access.branch_id`) whatever the query says; a user without a
branch sees nobody. Marking someone of another branch is 403. The scan flow's payment step needs
payroll's `salary_advances` (the UI hides it without).

**Money is for `salary_advances` only (server-side):** without it the report has no payment badges,
the employee month has no `advance` / `salary` amounts and an empty `payments`, and the day list
rows have no `payments_today` - the Manager preset included.

## Tables (attendance_0001, runs after core → admin → payroll)

```
attendance.records
  id bigserial PK
  employee_id int NOT NULL → core.employees ON DELETE RESTRICT
  date date NOT NULL                     -- the Kathmandu AD day; date_bs is derived on output
  status char(1) CHECK IN ('P','O','A')
  overtime_hours smallint DEFAULT 0      -- CHECK 0..12 AND (status = 'O') = (overtime_hours > 0)
  branch_id int NOT NULL → core.branches -- the employee's branch on that day
  source varchar(6) CHECK IN ('manual','scan','bulk')
  marked_by int → core.users ON DELETE SET NULL
  marked_at timestamptz DEFAULT now()
  note varchar(200) DEFAULT ''
  UNIQUE (employee_id, date), INDEX (date, branch_id)

attendance.record_changes
  id, record_id (plain number), employee_id → core.employees, date, old_status / new_status
  (null = not marked / cleared), old_hours, new_hours, old_note, new_note, source, changed_by,
  changed_at; INDEX (employee_id, date)
```

The API keeps the frontend's names: `ot_hours` (= overtime_hours), `marked_via` (= source),
`updated_at` (= marked_at), `marked_by` as the username.

## Endpoints (`/api/attendance`, session cookie, `X-CSRF-Token` on unsafe methods)

Every response carries the AD `date` and the BS `date_bs` (records: `date_ad` / `date_bs`).

| Method | Path | Body / query | Answer | Permission |
|---|---|---|---|---|
| GET | `/day?date_bs=&branch=&department_id=` | | `DayAttendance`: day header, settings `{weekly_off: 6}`, branches with headcount, departments of the branch, active staff joined by that day (department, then name) with the record or null and `payments_today {advance, salary}` from payroll | mark |
| POST | `/mark` | `{date_bs, employee_id, status, ot_hours, note?}` | `{record, previous}` – one upsert for mark, change status and set overtime | mark |
| DELETE | `/mark?employee_id=&date_bs=` | | `{previous, now: N\|W}` – "Clear mark", idempotent | mark |
| POST | `/bulk-mark` | `{date_bs, branch_id, employee_ids? \| department_id?}` | `{marked: [{employee_id, name}], skipped, records}` – Present only for the still unmarked, one `INSERT … ON CONFLICT DO NOTHING` | mark |
| GET | `/lookup?employee_id=` | after payroll's `GET /api/payroll/employees/by-barcode/{code}` (TTK-E001, legacy TTK-E-001, E-001, 1) | `{code, employee, today: record \| null}` | mark |
| POST | `/scan` | `{employee_id, action: present\|overtime, ot_hours}` | `{employee, record, previous}` – today, source scan | mark |
| GET | `/employees/{id}/month?bs_year=&bs_month=` | | `EmployeeMonth`: cells (P/O/A/W/N + advance / salary paid that day), totals, payments newest first | mark or report |
| GET | `/marked-days?bs_year=&bs_month=&branch=\|employee_id=` | | `{marked_days: [BS dates]}` – BSDatePicker dots | mark or report |
| GET | `/report?bs_year=&bs_month=&branch=` | branch left out = every branch (see_other_branches) | `MonthReport`: month with days, rows (cells + totals incl. `saturday_days_worked` / `saturday_ot_hours`), `staff_present` per day, payment badges from `PayrollPayments.for_month`, `branch_id`, `today` | report |

Future months are 404. Week and day views and the Excel / PDF exports are built in the browser from
`/report` (`xlsx.ts`, `print.ts`), so they always match the screen.

Report rows: everyone of the branch who had joined by the month's end and was still active at its
start, plus anyone with a mark in that branch that month (moved or left since); a moved employee
shows only the days marked in that branch. Cells: a Saturday without a record is `W` (also in the
future part of the running month), days before joining are `N`.

## Contracts (app/contracts.py)

- `AttendanceSummary.for_month(employee_id, bs_year, bs_month) -> MonthSummary` (registered at import):
  past month = the whole month; **running month = days up to today** (`days_counted` = today's BS
  day); a month not started = 0. Saturday marks go only into `saturday_days_worked` /
  `saturday_ot_hours`; `weekly_off` counts every Saturday so far (from the joining date);
  `paid_days = present + overtime_days + weekly_off`.
- `AttendanceSummary.today(employee_ids, day=None)` – present / overtime / absent / weekly_off /
  not_marked, for payroll's Today column.
- Payroll's `PayrollPayments` (for the report badges, employee month and the day list's payment flags).

## Dashboard

`attendance_today` widget and `/api/today` counts: today's records of the caller's branch (every
branch with see_other_branches): total, present, overtime (+ hours), absent, not_marked (0 on a
Saturday – nobody needs a mark), `weekly_off`, `not_in` (absent first, then not marked; 8 names).

## Scan flow's payment step (web/components/attendance/scan/scanFlow.ts)

Only with `salary_advances`. Paid by: Cash | Other ▾ (payroll's `PaidByPicker`, active modes from
`/api/admin/payment-modes?active=1`). An **advance** counts for the running month: the sheet posts no
`for_year` / `for_month` (payroll defaults them to the BS month of the payment date). A **salary**
counts for payroll's settlement month – `salary_month` of `GET /api/payroll/employees/{id}/summary`
(the previous BS month while anything is still due for it, else the running month) – sent as
`for_year` / `for_month`, and the sheet says "Salary for Ashwin 2083". Balance:
`GET /api/payroll/balance`; history: `GET /api/payroll/employees/{id}/ledger/{YYYY-MM}`.

## Saturday work – PENDING BUSINESS DECISION

Marking P / O on a Saturday is allowed and stored. Payroll applies one setting,
`payroll.saturday_work_rule` (core.settings, admin Settings › Payroll, admin only,
`GET/PUT /api/admin/settings/payroll`, audited):

- `overtime_only` (default): monthly staff are paid only the overtime hours worked on the Saturday.
- `extra_day`: they also get salary ÷ 30 per Saturday worked (inside gross).

Daily-wage staff always get the day's wage plus the hours for Saturday work, whatever the setting.
Revisit once the business decides; the setting and both code paths are tested
(`tests/payroll/test_attendance_pay.py`, `tests/payroll/test_rules.py`).
