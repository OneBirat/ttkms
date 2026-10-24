# Attendance – API notes (implement after UI sign-off)

Written 24 Oct 2026, updated 25 Oct 2026 for the final design pack (`design/final/`). The web
screens already call these shapes through `web/components/attendance/api.ts` (mock); the TypeScript
types in `web/components/attendance/types.ts` are the contract – keep the Pydantic models identical.
The step-by-step backend plan (table, migration, permissions, order of work) is in
`docs/attendance-backend-plan.md`.

## Rules

- Status is only `P` present, `O` overtime (present + whole hours 1–12), `A` absent.
- Weekly off = Saturday (`settings.weekly_off`, 0 = Sunday … 6 = Saturday), shown as `–` / `W`.
  A weekly-off day without a record is paid as weekly off; a record on it (overtime worked on a
  Saturday) is reported as marked.
- "Not marked" = no record. One record per employee per day. **Every mark saves at once** – there
  is no draft / Save button any more.
- Paid days = P + O + weekly off. Absent is unpaid. Overtime hours are paid hourly (payroll).
- Dates: store both `date_bs` and `date_ad`; BS everywhere in the UI, AD second. Future days are
  never writable (422).
- Permissions (see the plan): `mark_attendance`, `view_attendance_report`, `see_other_branches`.
  Without `see_other_branches` every call is scoped to the user's own branch and `branch` is ignored.

## Endpoints (all under `/api/attendance`, session cookie + `X-CSRF-Token` on unsafe methods)

| Method | Path | Request | Response (types.ts) | Permission |
|---|---|---|---|---|
| GET | `/day?date_bs=YYYY-MM-DD&branch=<id>` | — (the web UI filters, searches and pages locally) | `DayAttendance`: day header, settings, branches (headcount), departments of the branch (headcount), every active employee of the branch with that day's record or `null` | `mark_attendance` |
| POST | `/mark` | `MarkOneRequest {date_bs, employee_id, status: P\|O\|A, ot_hours, note?}` | `MarkOneResponse {record, previous}` – upsert on (employee, day); `previous` is the status it replaced (`N` when none); 422 when `O` has hours outside 1–12 or `P`/`A` carry hours, or the day is in the future; 404 unknown / inactive employee; `marked_via = manual` | `mark_attendance` |
| POST | `/bulk-mark` | `BulkMarkRequest {date_bs, branch_id, employee_ids?: int[], department_id?: int}` – one of the two scopes is required | `BulkMarkResponse {marked: [{employee_id, name}], skipped: int[], records}` – **one transaction**; writes `P` only for employees in scope **without a record that day**, the rest come back in `skipped`; never overwrites | `mark_attendance` |
| GET | `/lookup?code=TTK-E004` | `code` is whatever the scanner/typist sent: `TTK-E004`, `E-004`, `E004`, `4` all resolve to `E-004` (see `normalizeCode` in helpers.ts) | `LookupResponse {code, employee, today}`; 404 when no active employee matches | `mark_attendance` |
| POST | `/scan` | `ScanRequest {code, action: present\|overtime, ot_hours}` | `ScanResponse {employee, record}` – upserts today's record at once, `marked_via = scan` | `mark_attendance` |
| GET | `/employees/{id}/month?bs_year=&bs_month=` | | `EmployeeMonth {employee, month, cells[], totals, payments[]}` – one person's month for the attendance-record sheet; `cells` carry `advance` / `salary` rupees paid that day; `payments` is the payroll history of the month (newest first) | `mark_attendance` or `view_attendance_report` |
| GET | `/report?bs_year=&bs_month=&branch=` | `week`, `day` and `dept` are sliced client-side | `MonthReport`: month (days with BS/AD/weekday/weekly off), settings, `branches` the user may report on, departments of the branch, one row per active employee with 1 cell per day (`status` P/O/A/W/N, `ot_hours`, `advance?`, `salary?`) and `AttendanceTotals` | `view_attendance_report` |
| GET | `/report/export.xlsx?bs_year=&bs_month=&branch=&dept=&q=&sort=` | | openpyxl workbook, sheets **Summary / Daily grid / By department** – columns of `web/components/attendance/xlsx.ts`: Emp ID, Name, Department, days, `P`, `O`, `A`, `W`, `Paid`; cells `✓`, overtime hours as a number, `A`, `–`, blank when unmarked | `view_attendance_report` |
| GET | `/report/export.pdf?bs_year=&bs_month=&branch=&dept=&q=&sort=&hide_saturdays=0\|1` | | WeasyPrint, A4 landscape, layout of `print.ts`: header, boxes Total staff / Present per day (avg) / Total present days / Overtime (h) / Absent days, grouped grid with columns `P O A W Paid` (widths days 24, P 26, O 30, A 24, W 24, Paid 34 px, name auto), Saturdays merged per department into a vertical red "SATURDAY" band or left out with `hide_saturdays=1`, staff-present footer, legend "✓ present · number = overtime hours …" | `view_attendance_report` |
| GET | `/status?date_bs=&employee_ids=1,2,3` | `date_bs` defaults to today | `[{employee_id, status: P\|O\|A\|W\|N, ot_hours}]` – today's status for payroll's screens (also exposed in-process through `AttendanceSummary`) | any signed-in user of attendance or payroll |
| GET | `/api/today` (core) | | `TodayRef` once the BS table is on the server; the UI converts locally meanwhile | — |

`PUT /day` (save a whole day at once) is no longer called by the UI; keep it out of the backend
pass unless payroll asks for it. Months for the report ‹ › navigation are computed in the browser
(current + 2 previous); no endpoint.

Dashboard widget `attendance_today` (`AttendanceTodayWidgetData`): computed from today's records
of all active employees of the user's branch(es): `total`, `present` (P), `overtime` (O),
`overtime_hours`, `absent`, `not_marked`, `not_in` (A or N rows, name + status), `mark_path`.

## Database

```
attendance.records
  id            bigserial PK
  employee_id   int NOT NULL REFERENCES core.employees(id)
  date_bs       char(10) NOT NULL      -- "2083-07-04"
  date_ad       date NOT NULL
  status        char(1) NOT NULL CHECK (status IN ('P','O','A'))
  ot_hours      smallint NOT NULL DEFAULT 0 CHECK (ot_hours BETWEEN 0 AND 12)
                                         -- CHECK ((status = 'O') = (ot_hours > 0))
  note          varchar(200) NOT NULL DEFAULT ''
  marked_by     int NULL REFERENCES core.users(id) ON DELETE SET NULL
  marked_via    varchar(6) NOT NULL CHECK (marked_via IN ('manual','scan','bulk'))
  updated_at    timestamptz NOT NULL DEFAULT now()
  UNIQUE (employee_id, date_ad)
  INDEX (date_ad), INDEX (employee_id, date_ad)
```

Settings (core.settings): `attendance.weekly_off` (default 6).

## Payroll client (contract payroll implements)

Attendance only calls these from `api.ts`; nothing in attendance reads payroll tables. The report
and the attendance-record sheet need the month's payments per employee (for the advance / salary
badges), so the attendance backend calls payroll's service in-process for `MonthReport` cells and
`EmployeeMonth.payments`.

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/payroll/balance?employee_id=&bs_year=&bs_month=` | | `MonthBalance {employee_id, month_key, month_label, net, paid, due}` |
| POST | `/api/payroll/payments` | `PaymentInput {employee_id, month_key, type: salary\|advance, amount, method: cash\|bank, source: "scan"}` | `PaymentResult {payment_id, amount, due_after, recorded_at}`; 422 when amount ≤ 0 or above `due` |
| GET | `/api/payroll/payments?employee_id=&bs_year=&bs_month=` | | `PaymentHistory {employee_id, month_key, month_label, payments: [{id, bs_date, type, amount, method, note, created_at}] (newest first), totals: {paid, net, due}}` – the scan flow's "Paid in {month}" card, the History sheet and the day-detail pop-up |

The scan flow always sends `method: "cash"` (the Cash / Bank toggle was removed from the sheet; the
column stays). Payroll's own shapes use `mode` for the method and `bs_year`/`bs_month` instead of
`month_key`; attendance's client adapts in `api.ts` once the real endpoints exist. The paid sheet
shows `PAY-{payment_id:04d}` as the receipt number.

## AttendanceSummary (app/contracts.py) – shape change (applied on main 2026-10-25)

```python
@dataclass
class MonthSummary:
    days_in_month: int
    present: int  # days marked P
    overtime_days: int  # days marked O
    overtime_hours: int  # sum of ot_hours
    absent: int
    weekly_off: int  # weekly-off days without a record
    paid_days: int  # present + overtime_days + weekly_off
```

(drop `late`, `half_days`, `leave`; add `overtime_days`, `overtime_hours`). The attendance module
then registers `AttendanceSummary.for_month(employee_id, bs_year, bs_month)` with
`register_attendance_summary(...)` at import: convert the BS month to its AD range with
`app.core.bsdate`, load the employee's records in the range, count statuses, `weekly_off` = days
whose weekday equals the setting and that have no record, `paid_days` as above. The same logic is
`computeTotals` / `paidDays` in `web/components/attendance/helpers.ts`, with tests to mirror.
