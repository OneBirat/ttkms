/**
 * People & payroll contract types.
 *
 * Shaped like the future FastAPI responses under /api/payroll (snake_case,
 * dates as "YYYY-MM-DD" strings, money as whole rupees). The mock api.ts
 * returns exactly these shapes so the pages do not change when the backend
 * lands. No SSF anywhere; TDS is a 0 placeholder column.
 */

import type { Role } from "@/lib/api";

// ------------------------------------------------------------- dates

/** A date in both calendars; BS is shown first everywhere, AD second. */
export interface DateBoth {
  bs: string;
  ad: string;
}

/** One Bikram Sambat month, e.g. { bs_year: 2083, bs_month: 7 } = Kartik 2083. */
export interface BsMonth {
  bs_year: number;
  bs_month: number;
}

// -------------------------------------------------------------- core

export interface Branch {
  id: number;
  name: string;
  is_active: boolean;
}

/**
 * One row of GET /api/core/departments (app/core/schemas.py DepartmentOut). Company-wide;
 * `core.departments.is_active` exists but the API and UI ignore it - a department is listed
 * until it is deleted, which the server allows only at employee_count 0.
 */
export interface Department {
  id: number;
  name: string;
  /** Every employee referencing it, former staff included. */
  employee_count: number;
  active_employee_count: number;
}

/** Login linked to an employee (core.users). */
export interface EmployeeLogin {
  user_id: number;
  username: string;
  role: Role;
  role_label: string;
}

export type PayType = "monthly" | "daily";
export type PaidBy = "cash" | "bank";

/** payroll.employees joined with branch, department and the optional login. */
export interface Employee {
  id: number;
  /** "E-001" */
  code: string;
  /** Code 128 value printed on the sticker: "TTK-E001". Unique. */
  barcode: string;
  full_name: string;
  /** Name in Devanagari, optional (shown under the name and on payslips). */
  full_name_np: string | null;
  phone: string | null;
  /** Extra contact (family member, second number). */
  phone_alt: string | null;
  address: string | null;
  branch: Branch;
  department: Department | null;
  designation: string | null;
  active: boolean;
  joined: DateBoth;
  /** URL of the stored photo (or a data: URL in the mock); null = initials. */
  photo_url: string | null;
  login: EmployeeLogin | null;
  created_at: string;
}

// ------------------------------------------------------------ salary

/**
 * One row of payroll.salary_history; the latest effective row is current.
 * Monthly: gross (= basic + allowances) is the salary per month.
 * Daily: basic is the wage per day (allowances normally 0).
 */
export interface SalaryStructure {
  id: number;
  employee_id: number;
  pay_type: PayType;
  basic: number;
  allowances: number;
  /** basic + allowances */
  gross: number;
  /** Rupees per overtime hour. Default: salary ÷ days in month ÷ 8. */
  ot_rate: number;
  paid_by: PaidBy;
  effective_from: DateBoth;
  reason: string | null;
  /** Gross of the structure this one replaced, for "previous Rs X". */
  previous_gross: number | null;
}

// -------------------------------------------------------- attendance

/**
 * Mirrors AttendanceSummary.for_month(employee_id, bs_year, bs_month) in
 * app/contracts.py (NEEDS FROM MAIN: this shape; no late/half/leave).
 * present = days marked P, overtime_days = days marked O (worked, with hours),
 * absent = days marked A; weekly off (Saturday) is none of those.
 */
export interface MonthSummary {
  days_in_month: number;
  present: number;
  overtime_days: number;
  /** Whole hours, summed over the month. */
  overtime_hours: number;
  absent: number;
  weekly_off: number;
  /** Monthly: days_in_month − absent. Daily: present + overtime_days. */
  paid_days: number;
}

// ------------------------------------------------------ payment modes

export type PaymentModeType = "cash" | "bank" | "wallet" | "qr" | "cheque";

/**
 * One row of GET /api/admin/payment-modes?active=1 (NEEDS FROM TTK-ADMIN,
 * which owns the CRUD). Cash is built in (id 1) and always active; the
 * others are admin-managed and show under "Other" when paying.
 */
export interface PaymentMode {
  id: number;
  type: PaymentModeType;
  name: string;
  /** "A/c ··4410", wallet number, QR label; null for cash. */
  details: string | null;
  use_salary: boolean;
  use_advance: boolean;
  active: boolean;
}

/** The mode a payment was made with, embedded on the payment row. */
export interface PaymentModeRef {
  id: number;
  type: PaymentModeType;
  name: string;
}

// ---------------------------------------------------------- payments

export type PaymentType = "salary" | "advance";
export type PaymentSource = "account" | "scan";

/** One row of payroll.payments. An advance is a part-payment of that month's salary. */
export interface Payment {
  id: number;
  /** "ADV-0412" / "SAL-0410" (type + zero-padded id). */
  receipt_no: string;
  employee_id: number;
  month: BsMonth;
  type: PaymentType;
  amount: number;
  /** payroll.payments.payment_mode_id (Cash = 1 by default). */
  payment_mode_id: number;
  payment_mode: PaymentModeRef;
  /** Bank / cheque reference; null for cash. */
  reference: string | null;
  note: string | null;
  date: DateBoth;
  /** Username of who recorded it. */
  recorded_by: string;
  source: PaymentSource;
  created_at: string;
}

/** Paid = due 0 · Part paid = something paid, something due · Pending = nothing paid. */
export type MonthStatus = "paid" | "part_paid" | "pending";

/**
 * One month of one employee's salary ledger, derived (never stored): the pay
 * rules applied to the salary structure in force and the attendance summary,
 * plus the payments recorded against that month.
 */
export interface MonthLedger {
  employee_id: number;
  month: BsMonth;
  /** First and last day of the BS month. */
  starts: DateBoth;
  ends: DateBoth;
  /** True for the month that is still running (figures are "so far"). */
  in_progress: boolean;
  pay_type: PayType;
  /** Monthly: gross salary per month. Daily: wage per day. */
  rate: number;
  ot_rate: number;
  attendance: MonthSummary;
  paid_days: number;
  /** Monthly: the salary. Daily: wage × (present + overtime days). */
  gross_salary: number;
  /** overtime_hours × ot_rate */
  overtime_pay: number;
  /** gross_salary + overtime_pay (the report's "Gross"). */
  earnings: number;
  /** Monthly: gross_salary ÷ days in month × absent days. Daily: 0. */
  absence_deduction: number;
  /** Tax placeholder, 0 for now. */
  tds: number;
  /** earnings − absence_deduction − tds */
  net: number;
  salary_paid: number;
  advance_paid: number;
  /** salary_paid + advance_paid */
  paid: number;
  /** max(0, net − paid) */
  due: number;
  status: MonthStatus;
  payments: Payment[];
}

// --------------------------------------------- cross-module contract

/**
 * GET /api/payroll/balance?employee_id=&bs_year=&bs_month= — what the
 * attendance scan pop-up shows before recording a payment. NEEDS FROM MAIN:
 * put MonthBalance / PaymentInput / PaymentResult in a shared contract.
 */
export interface MonthBalance {
  employee_id: number;
  bs_year: number;
  bs_month: number;
  /** "2083-07" */
  month_key: string;
  /** "Kartik 2083" */
  month_label: string;
  net: number;
  paid: number;
  /** net − paid, never negative. */
  due: number;
  status: MonthStatus;
  breakdown: {
    gross_salary: number;
    overtime_pay: number;
    absence_deduction: number;
    tds: number;
    salary_paid: number;
    advance_paid: number;
    in_progress: boolean;
  };
}

/** POST /api/payroll/payments body. Validated: 0 < amount ≤ due. */
export interface PaymentInput {
  employee_id: number;
  bs_year: number;
  bs_month: number;
  type: PaymentType;
  amount: number;
  /** Defaults to Cash (id 1) when omitted. */
  payment_mode_id?: number | null;
  reference?: string | null;
  note?: string | null;
  /** BS date "YYYY-MM-DD"; defaults to today. */
  date_bs?: string | null;
  source: PaymentSource;
}

export interface PaymentResult {
  payment: Payment;
  /** Balance due for that month after this payment. */
  due_after: number;
}

// ----------------------------------------------------------- reports

/** One line of the salary report sheet. */
export interface ReportRow {
  employee: Employee;
  ledger: MonthLedger;
}

export interface ReportTotals {
  staff: number;
  /** Sum of earnings (salary + overtime). */
  gross: number;
  absence_deduction: number;
  absent_days: number;
  overtime_pay: number;
  overtime_hours: number;
  /** Advances already paid against this month (part of the salary). */
  advance_paid: number;
  salary_paid: number;
  tds: number;
  net: number;
  due: number;
  paid_count: number;
  part_paid_count: number;
  pending_count: number;
}

export interface MonthNetTotal {
  month: BsMonth;
  net: number;
}

export interface DepartmentNetTotal {
  department: Department;
  staff: number;
  net: number;
}

export interface SalaryReport {
  month: BsMonth;
  rows: ReportRow[];
  totals: ReportTotals;
  /** Every department, unfiltered, for the chips and the chart. */
  by_department: DepartmentNetTotal[];
  /** Oldest first, the report month last. */
  trend: MonthNetTotal[];
  /** Staff on the sheet before the department filter. */
  all_staff: number;
}

/** One line of the payments register. */
export interface RegisterRow {
  payment: Payment;
  employee: Employee;
}

/**
 * Totals of the settlement month (the previous BS month while anything is
 * still due for it, otherwise the running month), independent of the range.
 */
export interface RegisterTotals {
  month: BsMonth;
  staff: number;
  /** Net payroll of the settlement month (all employees). */
  month_net: number;
  salary_paid: number;
  advance_paid: number;
  /** Still due for the settlement month. */
  due: number;
  /** Rows in the range after filters. */
  count: number;
  amount: number;
}

/** Settlement-month figures per employee (the "By employee" export sheet). */
export interface RegisterEmployeeTotal {
  employee: Employee;
  net: number;
  advance_paid: number;
  salary_paid: number;
  paid: number;
  due: number;
}

/** Payments of the range per department (the chips and the "By department" export sheet). */
export interface RegisterDepartmentTotal {
  /** null = employees without a department. */
  department: Department | null;
  count: number;
  salary: number;
  advances: number;
  total: number;
}

/** Date = newest first (default) · Department A-Z · Employee A-Z · Amount high to low. */
export type RegisterSort = "date" | "department" | "employee" | "amount";

/** GET /api/payroll/payments?from_bs&to_bs&type&employee_id&department_id&sort */
export interface PaymentsRegister {
  /** BS dates, inclusive. */
  from_bs: string;
  to_bs: string;
  /** The chosen department (rows, totals and by_employee are scoped to it); null = all. */
  department: Department | null;
  sort: RegisterSort;
  /** In `sort` order. */
  rows: RegisterRow[];
  totals: RegisterTotals;
  by_employee: RegisterEmployeeTotal[];
  /** Over the whole range and type filter, every department, so the chips keep their counts. */
  by_department: RegisterDepartmentTotal[];
}

/** From/To presets of the register (BS, inclusive). */
export type RangePreset = "this_month" | "last_month" | "last_30" | "last_3";

export interface DateRange {
  from_bs: string;
  to_bs: string;
}

export type RegisterTypeFilter = "all" | PaymentType;

// -------------------------------------------------------- today status

/**
 * Today's attendance mark per employee. NEEDS FROM TTK-ATTENDANCE:
 * GET /api/attendance/today?branch_id= -> { date, statuses: { [employee_id]: TodayStatus } }.
 */
export type TodayStatus = "present" | "overtime" | "absent" | "weekly_off" | "not_marked";

export interface TodayAttendance {
  date: DateBoth;
  statuses: Record<number, TodayStatus>;
}

/** One row of the all-staff table (GET /api/payroll/employees?branch_id=&with=today,balance). */
export interface EmployeeListRow {
  employee: Employee;
  pay_type: PayType;
  /** Monthly salary or daily wage in force this month. */
  rate: number;
  today: TodayStatus;
  /** Sum of the due of every month kept. */
  balance_due: number;
}

// ------------------------------------------------- transaction ledger

export type LedgerEntryType = "salary" | "absence" | "overtime" | "advance" | "salary_paid";

/**
 * One line of the employee's running ledger (derived, never stored). Salary
 * is earned on the last day of the BS month (today for the running month),
 * absence reduces it, overtime adds to it; payments go out.
 */
export interface LedgerEntry {
  id: string;
  date: DateBoth;
  month: BsMonth;
  type: LedgerEntryType;
  details: string;
  /** Positive earned, negative for absence. */
  earned: number;
  paid: number;
  /** Everything earned − everything paid up to this line. */
  balance: number;
  payment: Payment | null;
  in_progress: boolean;
}

export interface LedgerTotals {
  /** Salary earned after absence deductions. */
  salary: number;
  overtime: number;
  overtime_hours: number;
  months: number;
  advances: number;
  advance_count: number;
  salary_payments: number;
  salary_payment_count: number;
  /** Balance due over every month kept. */
  balance: number;
}

/** GET /api/payroll/employees/{id}/transactions — oldest first. */
export interface EmployeeLedger {
  employee_id: number;
  entries: LedgerEntry[];
  totals: LedgerTotals;
}

// ------------------------------------------------------ account summary

/** What the Give advance / Pay salary dialogs show (GET /api/payroll/employees/{id}/summary). */
export interface AccountSummary {
  employee_id: number;
  /** The running month advances are given against. */
  month: BsMonth;
  /** Net so far this month. */
  earned_so_far: number;
  paid_this_month: number;
  /** max(0, earned_so_far − paid_this_month) */
  room: number;
  /** The month "Pay <month> salary" targets: its net, what is paid and what is due. */
  salary_month: BsMonth;
  salary_net: number;
  salary_paid: number;
  salary_due: number;
  /** Newest first, every month. */
  recent: Payment[];
  /** Advances paid in the last four months. */
  advances_recent: number;
  /** Due over every month kept. */
  balance_due: number;
  overtime_hours_this_month: number;
}

// ------------------------------------------------------------- photo

export interface PhotoToken {
  token: string;
  employee_id: number;
  /** Absolute URL for the QR code. */
  url: string;
  expires_at: string;
}

export interface PhotoTokenInfo {
  employee: Employee;
  expires_at: string;
}

// ------------------------------------------------------------ inputs

export interface EmployeeIn {
  full_name: string;
  full_name_np?: string | null;
  phone: string;
  phone_alt?: string | null;
  address?: string | null;
  branch_id: number;
  department_id: number;
  designation: string;
  pay_type: PayType;
  /** Salary per month or wage per day. */
  amount: number;
  paid_by: PaidBy;
  /** BS date; defaults to today. */
  joined_bs?: string | null;
  photo_data_url?: string | null;
  login?: { username: string; role: Role } | null;
}

export interface EmployeeUpdateIn {
  full_name: string;
  full_name_np: string | null;
  phone: string;
  phone_alt: string | null;
  address: string | null;
  branch_id: number;
  department_id: number;
  designation: string;
  active: boolean;
  joined_bs: string;
}

export interface SalaryRevisionIn {
  pay_type: PayType;
  basic: number;
  allowances: number;
  ot_rate: number;
  paid_by: PaidBy;
  /** BS date "YYYY-MM-DD". */
  effective_from_bs: string;
  reason?: string | null;
}

export type EmployeeSort = "name" | "code" | "designation";
export type ReportSort = "dept" | "name" | "net" | "due" | "paid_days";
