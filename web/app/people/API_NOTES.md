# People & payroll — API / DB notes

**Built 2026-10-26.** The UI runs on `web/app/people/api.ts`, a thin client over `/api/payroll`
(`app/modules/payroll/`: schema `payroll`, migration `payroll_0001`) and the core branch / department
endpoints; the old mock lives on as `_lib/mockApi.ts` for the unit tests only. Shapes are in `types.ts`
(`kind`, `earned`, `for_year` / `for_month` as in `app/contracts.py`). The build notes below are kept as
the reference for the rules; `docs/payroll-backend-plan.md` has the endpoint table.

## Business rules (decided)

- No SSF anywhere. TDS stays in the data as 0 but is not shown anywhere in the UI or the exports (2026-10-25).
- Monthly: `net = gross − gross ÷ 30 × absent + overtime_hours × ot_rate − tds` (a fixed 30, whatever the BS month's length).
  Saturdays (weekly off) are paid. No half days, no leave.
- Daily: `net = wage × (present + overtime_days + Saturdays worked) + overtime_hours × ot_rate − tds`.
- Running month ("earned so far", also the advance cap): `gross × min(days_counted, 30) ÷ 30`, then
  the absences and overtime so far (added 2026-10-25; past months are never prorated).
- Saturday work – **pending business decision**, setting `payroll.saturday_work_rule`:
  `overtime_only` (default, monthly staff get the Saturday hours only) or `extra_day` (also gross ÷ 30
  per Saturday). Daily staff always get the wage + hours (`calc.ts` `PayOptions`).
- Overtime rate per employee, default `gross ÷ 30 ÷ 8` (daily: `wage ÷ 8`), editable on the
  salary structure (`web/app/people/_lib/calc.ts`, unit-tested).
- Advances are part-payments of that month's salary: no recovery, no carry-over.
  Month status is derived: `due = max(0, net − Σ payments)`; Paid (due 0) / Part paid / Pending.
- A payment can never exceed the due; several payments per month; cash or bank (+ reference).
- Attendance input comes only from `AttendanceSummary.for_month(employee_id, bs_year, bs_month)`.

## Tables

Employees are `core.employees` (single source of truth, owned by `main`): id, code, full_name, phone,
branch_id, department_id, designation, status active|inactive, photo_path. Payroll adds no employees
table; the missing profile fields (full_name_np, phone_alt, address, joined_bs/joined_ad, user_id,
barcode) are added to `core.employees` by a core migration when the payroll backend is built.
Payroll keeps only its own tables, keyed on `core.employees.id`:

```
payroll.salary_history   id, employee_id, effective_bs, effective_ad, pay_type, basic, allowances,
                         ot_rate, paid_by, reason, created_at
payroll.payments         id, receipt_no "ADV-0412"/"SAL-0410", employee_id, bs_year, bs_month,
                         type salary|advance, amount, payment_mode_id (admin.payment_modes, Cash default),
                         reference, system_remark (server-written at creation, read-only), note (human,
                         editable) + note_updated_by / note_updated_at (payroll_0004), date_bs, date_ad,
                         recorded_by (core.users), source account|scan, created_at
payroll.photo_tokens     token, employee_id, expires_at  (or keep in the session store)
```

Month ledger rows are never stored: they are computed from the structure in force, the attendance
summary and the month's payments (`ledgerFor` in api.ts shows the exact derivation).

## Endpoints (JSON, roles admin + manager; `/api/payroll`)

| Method | Path | Request → Response |
|---|---|---|
| GET | /employees | → Employee[] |
| GET | /employees/{id} | → Employee |
| GET | /employees/by-barcode/{barcode} | → Employee (attendance scanner) |
| GET | /employees/next-code | → { code, barcode } |
| POST | /employees | EmployeeIn → { employee, one_time_password } (409 + field on duplicate phone/username) |
| PATCH | /employees/{id} | EmployeeUpdateIn → Employee |
| GET | /employees/{id}/photo?size=full\|thumb&v=<hash> | signed-in users who may see the employee (people or attendance permissions; 401 without a session): `full` = 600 px JPEG q80 (profile, barcode views), `thumb` = 128 px WebP (lists, side strip, avatars, attendance cards); with the current `v` → `Cache-Control: private, max-age=31536000, immutable`, else `private, no-cache`. `Employee.photo_url` / `photo_thumb_url` and attendance `EmployeeRef.photo_url` (thumb) carry the versioned URLs |
| PUT/DELETE | /employees/{id}/photo | multipart image → Employee (both sizes stored under `MEDIA_DIR/employees/<id>/<hash>.jpg` / `.thumb.webp`, metadata stripped; the previous files are deleted) |
| GET | /employees/{id}/salary | → { current: SalaryStructure, history: SalaryStructure[] } |
| POST | /employees/{id}/salary | SalaryRevisionIn → SalaryStructure |
| GET | /employees/{id}/attendance?bs_year&bs_month | → { employee_id, month, summary: MonthSummary } |
| GET | /employees/{id}/ledger | → MonthLedger[] (newest first, from joining month) |
| GET | /employees/{id}/ledger/{YYYY-MM} | → MonthLedger |
| GET | /employees/{id}/payslips/{YYYY-MM}.pdf | → PDF (core.export) |
| GET | /employees/{id}/ledger.xlsx | → Excel |
| GET | /months | → BsMonth[] |
| GET | /balance?employee_id&bs_year&bs_month | → MonthBalance (cross-module) |
| POST | /payments | PaymentInput → PaymentResult (422 + field when amount is 0 / above due / future) |
| GET | /employees/{id}/salary-dues | → SalaryDues: oldest month with anything due → running month (cleared months in between, with `cleared_on`), `total_due`, `past_due`, `running_due` |
| POST | /salary-payments | SalaryPaymentInput → 201 SalaryPaymentResult: one amount split oldest month first in ONE transaction - one salary row per month, one receipt number, one `payment_group_id`; 422 `over_total` (+ `cap`) above the total due; the running month only up to earned so far |
| GET | /employees/{id}/transactions | → EmployeeLedger (running balance): earned rows name their month ("Ashwin salary · 31 days", "Ashwin · 1 day(s) × Rs 800", "Ashwin · 6 h × Rs 100"); ONE row per payment group (a bulk salary payment = one row on its payment date with the group total, `group_months` [{for_year, for_month, amount, cleared}]); `payment.system_remark` / `note` per row |
| PATCH | /payments/{id}/note | { note } (salary_advances) → Payment: the human note of the whole group; "" clears it; audit `payment_note` old → new; the system remark cannot be sent (422) |
| GET | /employees/{id}/summary | → AccountSummary (Give advance / Pay salary) |
| GET | /payments?from_bs&to_bs&type&employee_id&branch_id&department_id&sort | → PaymentsRegister (BS date range; `branch_id` (omitted = all branches; users without `see_other_branches` are always scoped to their own branch) and `department_id` scope rows, tiles, by_employee and the `by_department` chip counts; `sort` = date (default, newest first) \| branch (A-Z) \| department (A-Z, inside each branch when all branches) \| employee (A-Z) \| amount (high → low); `by_branch` = salary / advances / total / count per branch of the range; 404 unknown branch or department) |
| GET | /payments/{id}/receipt.pdf | → PDF |
| GET | /payments/export.xlsx, .pdf?from_bs&to_bs&type&branch_id&department_id&sort | → file: Excel sheets Payments (rows in `sort` order, Department and Branch columns inside the autofilter) / **By branch** (branch, salary, advances, total, count; only without `branch_id`) / **By department** (department, salary, advances, total, count) / By employee / Summary / Sort & filter; PDF A4 landscape titled "Payment report · {Branch or All branches} · {Department if any} · {range}", `sort=branch` grouped per branch with a subtotal row (Salary · Advances · Total), `sort=department` grouped per department (nested inside branch headings + branch subtotals when all branches) and the grand total last; file name `Payment_report[_{Branch}][_{Department}]_{from}_to_{to}.{ext}` |
| GET | /report/{YYYY-MM}?department_id&branch_id | → SalaryReport (`branch_id` omitted = all branches, same locking rule as the register; rows, totals, trend and `by_department` follow the branch; `by_branch` = staff / net / paid / due per branch with the department filter applied) |
| GET | /report/{YYYY-MM}.xlsx, .pdf?department_id&branch_id | → file; with all branches a Branch column and the "By branch" summary; title "Salary report · {Branch or All branches} · {Department if any} · {month}"; file `salary-{YYYY-MM}-{branch}[-{department}]` |
| POST | /photo-tokens | { employee_id } → PhotoToken (10 min) |
| GET | /photo-tokens/{token} | → PhotoTokenInfo (no session; 410 when expired) |
| POST | /photo-tokens/{token}/photo | multipart image, no session → Employee |

## Branch selection (Employees, Payment reports, Salary report; one branch since 2026-10-25)

`_lib/branchScope.ts` (tested) + `useReportBranch`: always exactly one branch, never "All branches". With
`see_other_branches` a Branch drop-down (house icon) of every active branch A-Z, left of the month/date
controls (phone: the header pill); default = the session's own branch, else the first branch. Without it no
drop-down: the page is locked to the session `branchId` and shows the branch name as a small label.
`?branch=` sits in the URL next to `?dept=&sort=`; the UI always sends `branch_id` (screens wait with
`waitForBranch()` until it is known); department chip counts, tiles and exports follow the branch, and the
PDF title / file name name it. The API still answers `by_branch`; the UI does not show it.

## Employee account (`/people/employees/[id]`, 2026-10-25)

Left list = the staff of the employee's branch only ("Staff · {Branch}", own department first with the
dark header); « collapses it to a 72px avatar strip (tooltip "Name · E-001", current ringed, separators
between departments, a dark one before the own department), » opens it again; remembered in
localStorage `ttk.people.staffList.collapsed`. Tabs: Overview · Salary · Ledger · Documents. "Pay salary"
opens the Pay salary dialog (see below). Salary tab cards: **Attendance** (manage_employees or view_attendance_report) from
`GET /api/attendance/employees/{id}/month` - Sun–Sat grid, chips, ‹ › from the joining month to the
running month, "View all ›" to `/attendance/report?employee=&bs_year=&bs_month=`; no attendance money is
shown. **Last 6 payments** (salary_advances): newest non-voided payments from the ledger, "Open ledger ›".
Revise salary lives in Edit profile › Salary. Rules in `_lib/account.ts` (tested).

## Pay salary - one amount, oldest month first (2026-10-25)

`PaySalaryDialog` (desktop, with the Give advance "Recent payments" panel) and the phone `PaySheet`'s
Salary tab both render `SalaryPayForm`: the "Salary due · oldest first" table from `/salary-dues`, the
amount pre-filled with `past_due` (else the total), quick amounts (All past months · Everything incl.
{running month} · 5,000 · 10,000), the red "More than the total due…" state, the live "This payment covers"
split, Paid by Cash | Other ▾ (+ Reference), today's BS date; then "Salary paid" with the split chips and
"Nothing due now · all cleared {date}" / "Still due". `POST /salary-payments` does the split for real. The
attendance scan flow's salary step uses the same two endpoints (`salaryDues` / `paySalary` deps).

A group (rows sharing `payment_group_id`) is one entry everywhere a payment is listed: Payment reports
(`RegisterRow.split`, expandable on desktop, in the details sheet on the phone), the receipt PDF (total +
months), Recent payments and Last 6 payments (`paymentEntries`). The ledger and the per-month totals use
the per-month rows. Voiding any row voids the whole group (same reason).

Every month whose due reached 0 shows a tick + "Cleared {BS date}" (`MonthLedger.cleared_on` = the day of
the non-voided payment that brought the paid total up to the net) instead of "Paid": salary ledger,
Salary report (screen, PDF, Excel), payslip, phone. Rules in `_lib/settle.ts` (tested).

## Recorded by (2026-10-25)

`Payment.recorded_by` / `voided_by` (and "Printed by" on PDFs) are display names from
`payroll.services.user_label`: the user's full name, else the linked employee's name, else the username,
never a raw phone number ("User N" when nothing else is left). Screens, receipts and exports print them as is.

## Payment reports (`/people/payments`, renamed from "Payments" 2026-10-25)

Department chips ("All" + each department of `GET /api/core/departments` with its payment count for the
From/To range and branch, from `by_department`), Sort (Date · Department · Employee · Amount),
`?branch=&dept=&sort=` in the URL, tiles scoped to the chosen branch + department; Sort = Department groups
rows per department with a subtotal (Salary · Advances · Total) (`_lib/register.ts`: `sortRegisterRows`,
`groupRowsByDepartment`, `displayRows`). Phone: the same chips as a slider and the sort in a bottom sheet.

## Departments (real, `main`, 2026-10-25)

`web/app/people/api.ts` calls these for real (`apiFetch`); everything else in the file is still mock.
The rows are mirrored into the mock state so mock employees can point at new departments.

| Method | Path | Request → Response | Permission |
|---|---|---|---|
| GET | /api/core/departments | → `Department[]` A-Z: `{id, name, employee_count (former staff included), active_employee_count}` | any signed-in user |
| POST | /api/core/departments | `{name}` → 201 `Department`; 422 empty; `409 {code: "duplicate_name"}` (trimmed, case-insensitive, company-wide) | manage_employees |
| PATCH | /api/core/departments/{id} | `{name}` → `Department`; 404; `409 duplicate_name` | manage_employees |
| DELETE | /api/core/departments/{id} | → 204; 404; `409 {code: "department_in_use", count, inactive_count}` while any employee (active or former) references it; audit rows for add / rename / delete | manage_employees |

UI (`_components/ManageDepartmentsDialog.tsx`, rules in `_lib/departments.ts`): "Manage departments"
beside the department chips on `/people/employees` (desktop button, phone chip; only with
`manage_employees`), modal on desktop / bottom sheet on phone: name, count, inline Rename, Delete
(enabled only at 0 employees, otherwise "Move N employees first (includes former staff)"), confirm
"Delete department X permanently?", "+ Add department". The Add-employee popup's "+ Add new
department…" uses the same `AddDepartmentForm` and selects the new row. `core.departments.is_active`
is ignored. Branches (`GET/POST /api/core/branches`) are still mock.

## Needs from main

1. Nav section title "People" (core tests pin "People & payroll") and `tests/core/test_modules.py` /
   `tests/core/test_api.py` assert the first nav path is `/payroll`; the routes are `/people/*`.
2. `web/lib/modules.ts` `moduleForPath`: map `/people` → `payroll` (module-off guard). Done 2026-10-25.
3. `web/middleware.ts`: exempt `/people/photo/*` (token link opened on a phone without a session). Done 2026-10-25.
4. `app/contracts.py` MonthSummary: `days_in_month, present, overtime_days, overtime_hours, absent,
   weekly_off, paid_days` (drop late/half_days/leave); Fake to match. Done 2026-10-25.
5. Done 2026-10-25: `app/contracts.py` has `MonthBalance`, `PaymentInput` (`kind`, `payment_mode_id`,
   `date_bs`, `for_year` / `for_month`, `note`, `source`), `PaymentRecord`, `PaymentResult`,
   `PaymentRejected` and the `PayrollPayments` protocol (`balance` / `record` / `for_month`); payroll
   registers its service with `register_payroll_payments(...)` and `types.ts` should adopt the same field
   names (`earned` for the month's net so far, `kind` instead of `type`, `for_year` / `for_month` instead of
   `bs_year` / `bs_month` on payments). Payroll always sends `for_year` / `for_month`; the scan flow
   leaves them out and gets the month of the payment date.
6. Done: BS conversions, Nepal time and formatting come from `web/lib/bs` (shared with attendance
   and admin; same table as `app/core/bsdate.py`).
7. Done 2026-10-25: `/api/auth/me` carries `branch_id` and the effective `access` map
   (`useSession().branchId`, `can("see_other_branches")`; `_lib/useBranchScope.ts` replaces the first-branch
   fallback). `store_keeper` is retired (core_0005); `Role` and the Add-employee dropdown no longer have it.
8. Done 2026-10-25: the shell has a phone bar + `PhoneDrawer` under 640px; `PhoneFrame` opens it with
   `useShell().openMenu()` and claims the header with `usePhoneHeader()`; `(shell)/people.module.css` is gone.
9. Icons camera / switch-camera / qr / barcode / receipt / chevron-down/up in `components/icons.tsx`.
10. Optional: a barcode library (bwip-js or JsBarcode) if Admin › Barcodes wants one; `_lib/code128.ts`
    is dependency-free and can be replaced. Likewise `_lib/xlsx.ts` (stored-zip workbook writer) goes away
    once the backend serves the register through `app/core/export.py`.

## Needs from ttk-admin

- `GET /api/admin/payment-modes?active=1` → `PaymentMode[]` exactly as mocked in `listPaymentModes()`:
  `{ id, type: cash|bank|wallet|qr|cheque, name, details, use_salary, use_advance, active }`. Cash is
  built in (id 1) and always active. Payments store `payment_mode_id` (Cash by default); admins see
  "Manage payment modes" → `/admin/payment-modes` from the pay dialogs.
- Per-user permission switches (people.view / people.edit / salary.view / salary.edit / payments.view /
  payments.record) that `docs/payroll-backend-plan.md` gates the endpoints on.

## Needs from ttk-attendance

- `GET /api/attendance/today?branch_id=` → `{ date, statuses: { [employee_id]: present|overtime|absent|weekly_off|not_marked } }`
  for the "Today" column and tiles (mocked by `todayStatusFor()` in `_lib/mockData.ts`).
- Double-click on the attendance sheet opens `/people/employees/[id]?dept=<id or name>`.
- The scan pop-up records through `POST /api/payroll/payments` with `payment_mode_id`.
