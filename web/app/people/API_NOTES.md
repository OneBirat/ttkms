# People & payroll — API / DB notes (implement after UI sign-off)

The UI runs on `web/app/people/api.ts` (mock). Every function there is annotated with the
endpoint it stands in for; the shapes are in `types.ts`. Backend lives in
`app/modules/payroll/` (schema `payroll`), migrations in `migrations/payroll/`.

## Business rules (decided)

- No SSF anywhere. TDS is a 0 placeholder column.
- Monthly: `net = gross − gross ÷ days_in_month × absent + overtime_hours × ot_rate − tds`.
  Saturdays (weekly off) are paid. No half days, no leave.
- Daily: `net = wage × (present + overtime_days) + overtime_hours × ot_rate − tds`.
- Overtime rate per employee, default `gross ÷ days_in_month ÷ 8` (daily: `wage ÷ 8`), editable on the
  salary structure (`web/app/people/_lib/calc.ts`, unit-tested).
- Advances are part-payments of that month's salary: no recovery, no carry-over.
  Month status is derived: `due = max(0, net − Σ payments)`; Paid (due 0) / Part paid / Pending.
- A payment can never exceed the due; several payments per month; cash or bank (+ reference).
- Attendance input comes only from `AttendanceSummary.for_month(employee_id, bs_year, bs_month)`.

## Tables

```
payroll.employees        id, code "E-001" (core.next_employee_code()), barcode "TTK-E001" UNIQUE,
                         full_name, phone, phone_alt, address, branch_id, department_id, designation,
                         pay_type monthly|daily, amount, ot_rate, paid_by cash|bank, joined_bs, joined_ad,
                         photo_path, active, user_id (core.users, nullable), created_at
payroll.salary_history   id, employee_id, effective_bs, effective_ad, pay_type, basic, allowances,
                         ot_rate, paid_by, reason, created_at
payroll.payments         id, employee_id, bs_year, bs_month, type salary|advance, amount, mode cash|bank,
                         reference, note, date_bs, date_ad, recorded_by (core.users), source account|scan,
                         created_at
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
| PUT/DELETE | /employees/{id}/photo | multipart image → Employee |
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
| GET | /payments?bs_year&bs_month&type&employee_id | → PaymentsRegister |
| GET | /payments/{id}/receipt.pdf | → PDF |
| GET | /payments/export.xlsx, .pdf | same filters → file |
| GET | /report/{YYYY-MM}?department_id | → SalaryReport |
| GET | /report/{YYYY-MM}.xlsx, .pdf | → file |
| POST | /photo-tokens | { employee_id } → PhotoToken (10 min) |
| GET | /photo-tokens/{token} | → PhotoTokenInfo (no session; 410 when expired) |
| POST | /photo-tokens/{token}/photo | multipart image, no session → Employee |

Core endpoints used by the Add-employee popup: `GET/POST /api/core/branches`, `GET/POST /api/core/departments`.

## Needs from main

1. Nav section title "People" (core tests pin "People & payroll") and `tests/core/test_modules.py`
   asserts nav paths start with `/payroll`; the routes are `/people/*`.
2. `web/lib/modules.ts` `moduleForPath`: map `/people` → `payroll` (module-off guard).
3. `web/middleware.ts`: exempt `/people/photo/*` (token link opened on a phone without a session).
4. `app/contracts.py` MonthSummary: `days_in_month, present, overtime_days, overtime_hours, absent,
   weekly_off, paid_days` (drop late/half_days/leave); Fake to match.
5. Shared contract for `MonthBalance`, `PaymentInput`, `PaymentResult` (attendance's mock currently
   uses `month_key` + `method`; this module uses `bs_year`/`bs_month` + `mode` as the brief says).
6. `web/lib/bsdate.ts`: `adToBs`, `bsToAd`, `daysInBsMonth`, `todayAd` (copies live in `_lib/calendar.ts`
   and in the attendance worktree).
7. Roles: payroll pages for admin + manager; staff may later see their own ledger.
8. Icons camera / switch-camera / qr / barcode / receipt / chevron-down/up in `components/icons.tsx`.
9. Optional: a barcode library (bwip-js or JsBarcode) if Admin › Barcodes wants one; `_lib/code128.ts`
   is dependency-free and can be replaced.
