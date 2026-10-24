# Attendance – API notes (implement after UI sign-off)

Written 24 Oct 2026 for the backend pass. The web screens already call these shapes through
`web/components/attendance/api.ts` (mock); the TypeScript types in
`web/components/attendance/types.ts` are the contract – keep the Pydantic models identical.

## Rules

- Status is only `P` present, `O` overtime (present + whole hours 1–12), `A` absent.
- Weekly off = Saturday (`settings.weekly_off`, 0 = Sunday … 6 = Saturday), shown as `–`.
  A weekly-off day without a record is paid as weekly off; a record on it (overtime worked on a
  Saturday) is reported as marked.
- "Not marked" = no record. One record per employee per day.
- Paid days = P + O + weekly off. Absent is unpaid. Overtime hours are paid hourly (payroll).
- Dates: store both `date_bs` and `date_ad`; BS everywhere in the UI, AD second.
- Roles: admin and manager (`ROLES` in `__init__.py`).

## Endpoints (all under `/api/attendance`, session cookie + `X-CSRF-Token` on unsafe methods)

| Method | Path | Request | Response (types.ts) |
|---|---|---|---|
| GET | `/day?date_bs=YYYY-MM-DD&branch=<id>` | optional `dept`, `q`, `only_open`, `page` (the web UI filters and pages locally and does not send them) | `DayAttendance`: day header, settings, branches (headcount), departments of the branch (headcount), every active employee of the branch with that day's record or `null` |
| PUT | `/day` | `SaveDayRequest {date_bs, rows: [{employee_id, status: P\|O\|A, ot_hours, note}]}` | `SaveDayResponse {saved, records}` – **all-or-nothing** (one transaction); 422 when `O` has hours outside 1–12 or `P`/`A` carries hours; `marked_via = manual` |
| GET | `/lookup?code=TTK-E004` | `code` is whatever the scanner/typist sent: `TTK-E004`, `E-004`, `E004`, `4` all resolve to `E-004` (see `normalizeCode` in helpers.ts) | `LookupResponse {code, employee, today}`; 404 when no active employee matches |
| POST | `/scan` | `ScanRequest {code, action: present\|overtime, ot_hours}` | `ScanResponse {employee, record}` – upserts today's record at once, `marked_via = scan` |
| GET | `/report?bs_year=&bs_month=` | `week` and `dept` are accepted but the web UI slices client-side | `MonthReport`: month (days with BS/AD/weekday/weekly off), settings, departments, one row per active employee with 1 cell per day (`status` P/O/A/W/N, `ot_hours`) and `AttendanceTotals` |
| GET | `/report/export.xlsx?bs_year=&bs_month=&dept=&q=&sort=` | | openpyxl workbook, sheets **Summary / Daily grid / Overtime hours / By department** – same columns as `web/components/attendance/xlsx.ts` (`P`, `O h`, `A`, `Paid`; cells `P`, `O2`, `A`, `–`) |
| GET | `/report/export.pdf?bs_year=&bs_month=&dept=&q=&sort=` | | WeasyPrint, A4 landscape, layout of `print.ts` (header, 5 summary boxes, grouped grid, staff-present footer, legend "P present · O overtime (hours) · A absent · – weekly off") |
| GET | `/api/today` (core) | | `TodayRef` once the BS table is on the server; the UI converts locally meanwhile |

Months for the report select are computed in the browser (current + 2 previous); no endpoint.

Dashboard widget `attendance_today` (`AttendanceTodayWidgetData`): computed from today's records
of all active employees: `total`, `present` (P), `overtime` (O), `overtime_hours`, `absent`,
`not_marked`, `not_in` (A or N rows, name + status), `mark_path`.

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
  marked_via    varchar(6) NOT NULL CHECK (marked_via IN ('manual','scan'))
  updated_at    timestamptz NOT NULL DEFAULT now()
  UNIQUE (employee_id, date_ad)
  INDEX (date_ad), INDEX (employee_id, date_ad)
```

Settings (core.settings): `attendance.weekly_off` (default 6).

## Payroll client (contract payroll implements)

Attendance only calls these from `api.ts`; nothing in attendance reads payroll tables.

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/payroll/balance?employee_id=&bs_year=&bs_month=` | | `MonthBalance {employee_id, month_key, month_label, net, paid, due}` |
| POST | `/api/payroll/payments` | `PaymentInput {employee_id, month_key, type: salary\|advance, amount, method: cash\|bank, source: "scan"}` | `PaymentResult {payment_id, amount, due_after, recorded_at}`; 422 when amount ≤ 0 or above `due` |

## AttendanceSummary (app/contracts.py) – shape change needed on main

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
