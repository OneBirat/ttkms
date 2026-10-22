/**
 * People & payroll contract types.
 *
 * Shaped like the future FastAPI responses under /api/payroll (snake_case,
 * dates as "YYYY-MM-DD" strings, money as whole rupees). The mock api.ts
 * returns exactly these shapes so the pages do not change when the backend
 * lands.
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

export interface Department {
  id: number;
  name: string;
  is_active: boolean;
}

export type EmployeeStatus = "active" | "inactive";

/** Login linked to an employee (core.users). */
export interface EmployeeLogin {
  user_id: number;
  username: string;
  role: Role;
  role_label: string;
}

/** core.employees joined with branch, department and the optional login. */
export interface EmployeeProfile {
  id: number;
  code: string;
  full_name: string;
  phone: string | null;
  branch: Branch;
  department: Department | null;
  designation: string | null;
  status: EmployeeStatus;
  /** URL of the stored photo (or a data: URL in the mock); null = initials. */
  photo_url: string | null;
  login: EmployeeLogin | null;
  created_at: string;
}

// ------------------------------------------------------------ salary

export type PayType = "monthly" | "daily";
export type PaidBy = "cash" | "bank";

/**
 * Placeholder so allowances can be added later without a schema change.
 * Not shown anywhere yet.
 */
export interface AllowanceLine {
  name: string;
  amount: number;
}

/** One row of payroll.salary_structures; the latest effective row is current. */
export interface SalaryStructure {
  id: number;
  employee_id: number;
  pay_type: PayType;
  /** Salary per month (monthly) or wage per day (daily), whole rupees. */
  amount: number;
  paid_by: PaidBy;
  effective_from: DateBoth;
  /** Hidden for now; kept so the model can grow. */
  allowances: AllowanceLine[];
  /** Amount of the structure this one replaced, for "previous Rs X". */
  previous_amount: number | null;
}

// ---------------------------------------------------------- advances

export interface AdvanceRecovery {
  id: number;
  advance_id: number;
  payslip_id: number;
  month: BsMonth;
  amount: number;
}

export interface Advance {
  id: number;
  employee_id: number;
  amount: number;
  given_on: DateBoth;
  monthly_recovery: number;
  note: string | null;
  recoveries: AdvanceRecovery[];
  /** amount − sum(recoveries); 0 once cleared. */
  outstanding: number;
}

// -------------------------------------------------------- attendance

/** Mirrors app/contracts.py MonthSummary (the AttendanceSummary contract). */
export interface MonthSummary {
  days_in_month: number;
  /** Days present; a half day counts as ½ (so this can end in .5). */
  present: number;
  late: number;
  half_days: number;
  leave: number;
  absent: number;
  weekly_off: number;
  /** Paid days for monthly staff: days_in_month − absent − ½ × half_days. */
  paid_days: number;
}

export interface EmployeeMonthAttendance {
  employee_id: number;
  month: BsMonth;
  summary: MonthSummary;
}

// ----------------------------------------------------------- payroll

export type PayslipStatus = "pending" | "paid";
export type PayrollRunStatus = "draft" | "paid";

export interface Payslip {
  id: number;
  run_id: number;
  employee_id: number;
  month: BsMonth;
  pay_type: PayType;
  /** Salary per month or wage per day used for this slip. */
  rate: number;
  paid_by: PaidBy;
  days_in_month: number;
  /** Monthly: paid days from attendance. Daily: days present (half = ½). */
  paid_days: number;
  /** Monthly: absent + ½ × half days. Daily: 0 (nothing to deduct). */
  unpaid_days: number;
  gross: number;
  absence_deduction: number;
  advance_recovered: number;
  /** Tax placeholder, always 0 for now; not shown. */
  tds: number;
  net_pay: number;
  status: PayslipStatus;
  paid_on: DateBoth | null;
}

export interface PayrollRun {
  id: number;
  month: BsMonth;
  status: PayrollRunStatus;
  days_in_month: number;
  payslips: Payslip[];
}

export interface PayrollTotals {
  staff: number;
  gross: number;
  absence_deduction: number;
  unpaid_days: number;
  advance_recovered: number;
  advance_outstanding: number;
  net_pay: number;
  paid_count: number;
  pending_count: number;
}

/** Payslip joined with the employee for the salary report sheet. */
export interface PayrollSheetRow {
  payslip: Payslip;
  employee: EmployeeProfile;
}

export interface MonthNetTotal {
  month: BsMonth;
  net_pay: number;
}

export interface DepartmentNetTotal {
  department: Department;
  staff: number;
  net_pay: number;
}

export interface SalaryReport {
  month: BsMonth;
  run: PayrollRun;
  rows: PayrollSheetRow[];
  totals: PayrollTotals;
  by_department: DepartmentNetTotal[];
  /** Oldest first, the report month last. */
  trend: MonthNetTotal[];
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
  employee: EmployeeProfile;
  expires_at: string;
}

// ------------------------------------------------------------ inputs

export interface EmployeeIn {
  full_name: string;
  phone: string;
  branch_id: number;
  department_id: number;
  designation: string;
  pay_type: PayType;
  amount: number;
  paid_by: PaidBy;
  photo_data_url?: string | null;
  login?: { username: string; role: Role } | null;
}

export interface EmployeeUpdateIn {
  full_name: string;
  phone: string;
  branch_id: number;
  department_id: number;
  designation: string;
  status: EmployeeStatus;
}

export interface SalaryRevisionIn {
  pay_type: PayType;
  amount: number;
  paid_by: PaidBy;
  /** BS date "YYYY-MM-DD". */
  effective_from_bs: string;
}

export interface AdvanceIn {
  amount: number;
  /** BS date "YYYY-MM-DD". */
  given_on_bs: string;
  monthly_recovery: number;
  note?: string;
}

export type ReportSort = "dept" | "net" | "unpaid" | "name";
