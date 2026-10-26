/**
 * People & payroll API client - the real one, over /api/payroll (app/modules/payroll) and the
 * core branch / department endpoints. Pages import only this file; every function keeps the
 * signature the screens were built against (the mock twin for unit tests is
 * `_lib/mockApi.ts`). Mutations notify `subscribe` listeners so open screens refresh.
 */

import { apiFetch, type Role } from "@/lib/api";
import { thisMonth } from "./_lib/months";
import { monthKey, parseMonthKey } from "./_lib/months";
import type { EmployeeMonth as AttendanceEmployeeMonth } from "@/components/attendance/types";
import type {
  AccountSummary,
  Branch,
  BsMonth,
  Department,
  Employee,
  EmployeeIn,
  EmployeeLedger,
  EmployeeListRow,
  EmployeeUpdateIn,
  MonthBalance,
  MonthLedger,
  MonthSummary,
  Payment,
  PaymentInput,
  PaymentMode,
  PaymentResult,
  PaymentsRegister,
  PhotoToken,
  PhotoTokenInfo,
  RegisterSort,
  RegisterTypeFilter,
  SalaryReport,
  SalaryRevisionIn,
  SalaryStructure,
  SalaryDues,
  SalaryPaymentInput,
  SalaryPaymentResult,
} from "./types";

export type { Role };
export { monthKey, parseMonthKey };

// ---------------------------------------------------------------- refresh

type Listener = () => void;
const listeners = new Set<Listener>();

/** Re-run every screen that reads payroll data after a change (usePayroll). */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function changed(): void {
  listeners.forEach((listener) => listener());
}

async function mutate<T>(work: Promise<T>): Promise<T> {
  const result = await work;
  changed();
  return result;
}

function qs(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

const key = (month: BsMonth) => `${month.bs_year}-${String(month.bs_month).padStart(2, "0")}`;

// ------------------------------------------------------------------- core

/** GET /api/core/branches?active=1 */
export async function listBranches(): Promise<Branch[]> {
  return apiFetch<Branch[]>("/api/core/branches?active=1");
}

/** POST /api/core/branches {name} (manage_employees; 409 duplicate_name) */
export async function createBranch(name: string): Promise<Branch> {
  return mutate(apiFetch<Branch>("/api/core/branches", { method: "POST", json: { name } }));
}

/** GET /api/core/departments */
export async function listDepartments(): Promise<Department[]> {
  return apiFetch<Department[]>("/api/core/departments");
}

/** POST /api/core/departments {name} (manage_employees; 409 duplicate_name) */
export async function createDepartment(name: string): Promise<Department> {
  return mutate(apiFetch<Department>("/api/core/departments", { method: "POST", json: { name } }));
}

/** PATCH /api/core/departments/{id} {name} */
export async function renameDepartment(id: number, name: string): Promise<Department> {
  return mutate(apiFetch<Department>(`/api/core/departments/${id}`, { method: "PATCH", json: { name } }));
}

/** DELETE /api/core/departments/{id} (409 department_in_use {count, inactive_count}) */
export async function deleteDepartment(id: number): Promise<void> {
  await mutate(apiFetch<void>(`/api/core/departments/${id}`, { method: "DELETE" }));
}

// ---------------------------------------------------------- payment modes

/** GET /api/admin/payment-modes?active=1 - Cash first, then the admin-managed modes. */
export async function listPaymentModes(onlyActive = true): Promise<PaymentMode[]> {
  return apiFetch<PaymentMode[]>(`/api/admin/payment-modes${onlyActive ? "?active=1" : ""}`);
}

// -------------------------------------------------------------- employees

/** GET /api/payroll/employees (every branch the caller may see). */
export async function listEmployees(): Promise<Employee[]> {
  const rows = await apiFetch<EmployeeListRow[]>("/api/payroll/employees");
  return rows.map((r) => r.employee);
}

/** GET /api/payroll/employees?branch_id= - today's mark and the balance due (null without salary_advances). */
export async function listEmployeeRows(branch_id: number | null = null): Promise<EmployeeListRow[]> {
  return apiFetch<EmployeeListRow[]>(`/api/payroll/employees${qs({ branch_id })}`);
}

/** GET /api/payroll/employees/{id} */
export async function getEmployee(id: number): Promise<Employee> {
  return apiFetch<Employee>(`/api/payroll/employees/${id}`);
}

/** GET /api/payroll/employees/by-barcode/{barcode} ("TTK-E001"; the old "TTK-E-001" works too) */
export async function getEmployeeByBarcode(barcode: string): Promise<Employee> {
  return apiFetch<Employee>(`/api/payroll/employees/by-barcode/${encodeURIComponent(barcode.trim())}`);
}

/** GET /api/payroll/employees/next-code */
export async function nextEmployeeCode(): Promise<{ code: string; barcode: string }> {
  return apiFetch<{ code: string; barcode: string }>("/api/payroll/employees/next-code");
}

export interface EmployeeCreated {
  employee: Employee;
  /** Temporary password of the new login (shown once); null without a login. */
  one_time_password: string | null;
}

/** POST /api/payroll/employees -> 201 (409 duplicate_phone / duplicate_username with `field`, 422 with `field`) */
export async function createEmployee(input: EmployeeIn): Promise<EmployeeCreated> {
  return mutate(apiFetch<EmployeeCreated>("/api/payroll/employees", { method: "POST", json: input }));
}

/** PATCH /api/payroll/employees/{id} */
export async function updateEmployee(id: number, input: EmployeeUpdateIn): Promise<Employee> {
  return mutate(apiFetch<Employee>(`/api/payroll/employees/${id}`, { method: "PATCH", json: input }));
}

/** POST /api/payroll/employees/{id}/deactivate */
export async function deactivateEmployee(id: number): Promise<Employee> {
  return mutate(apiFetch<Employee>(`/api/payroll/employees/${id}/deactivate`, { method: "POST" }));
}

/** PUT (data URL) / DELETE /api/payroll/employees/{id}/photo */
export async function setEmployeePhoto(id: number, photo: string | null): Promise<Employee> {
  if (photo === null) {
    return mutate(apiFetch<Employee>(`/api/payroll/employees/${id}/photo`, { method: "DELETE" }));
  }
  return mutate(apiFetch<Employee>(`/api/payroll/employees/${id}/photo`, { method: "PUT", json: { photo_data_url: photo } }));
}

export interface SalaryStructureOut {
  current: SalaryStructure | null;
  /** Newest first. */
  history: SalaryStructure[];
}

/** GET /api/payroll/employees/{id}/salary */
export async function getSalaryStructure(employee_id: number): Promise<SalaryStructureOut> {
  return apiFetch<SalaryStructureOut>(`/api/payroll/employees/${employee_id}/salary`);
}

/** POST /api/payroll/employees/{id}/salary -> the structure now in force */
export async function reviseSalary(employee_id: number, input: SalaryRevisionIn): Promise<SalaryStructure> {
  const out = await mutate(
    apiFetch<SalaryStructureOut>(`/api/payroll/employees/${employee_id}/salary`, { method: "POST", json: input }),
  );
  return out.current ?? out.history[0];
}

// ------------------------------------------------------------- attendance

export interface EmployeeMonthAttendance {
  employee_id: number;
  month: BsMonth;
  summary: MonthSummary;
}

/** GET /api/payroll/employees/{id}/attendance?bs_year=&bs_month= (the attendance contract) */
export async function getAttendance(employee_id: number, month: BsMonth): Promise<EmployeeMonthAttendance> {
  return apiFetch<EmployeeMonthAttendance>(
    `/api/payroll/employees/${employee_id}/attendance${qs({ bs_year: month.bs_year, bs_month: month.bs_month })}`,
  );
}

/** GET /api/attendance/employees/{id}/month?bs_year=&bs_month= (the attendance module's employee month). */
export async function getAttendanceMonth(employee_id: number, month: BsMonth): Promise<AttendanceEmployeeMonth> {
  return apiFetch<AttendanceEmployeeMonth>(
    `/api/attendance/employees/${employee_id}/month${qs({ bs_year: month.bs_year, bs_month: month.bs_month })}`,
  );
}

// ----------------------------------------------------------------- months

/** The running BS month (Asia/Kathmandu), computed in the browser like the server does. */
export function currentMonth(): BsMonth {
  return thisMonth();
}

/** GET /api/payroll/months - newest first. */
export async function listMonths(): Promise<BsMonth[]> {
  return apiFetch<BsMonth[]>("/api/payroll/months");
}

// ---------------------------------------------------------------- ledgers

/** GET /api/payroll/employees/{id}/ledger - newest month first. */
export async function getLedger(employee_id: number): Promise<MonthLedger[]> {
  return apiFetch<MonthLedger[]>(`/api/payroll/employees/${employee_id}/ledger`);
}

/** GET /api/payroll/employees/{id}/ledger/{YYYY-MM} */
export async function getMonthLedger(employee_id: number, month: BsMonth): Promise<MonthLedger> {
  return apiFetch<MonthLedger>(`/api/payroll/employees/${employee_id}/ledger/${key(month)}`);
}

/** The month "Pay salary" targets: previous month while something is due for it, else this one. */
export async function suggestPayMonth(employee_id: number): Promise<BsMonth> {
  return (await getAccountSummary(employee_id)).salary_month;
}

// --------------------------------------------------------------- payments

/** GET /api/payroll/balance?employee_id=&for_year=&for_month= (the shared contract's MonthBalance) */
export async function getBalance(employee_id: number, month: BsMonth): Promise<MonthBalance> {
  return apiFetch<MonthBalance>(
    `/api/payroll/balance${qs({ employee_id, for_year: month.bs_year, for_month: month.bs_month })}`,
  );
}

/** POST /api/payroll/payments -> 201 (422 with `field`: amount / over_room / over_due / payment_mode_id / date_bs / for_month) */
export async function recordPayment(input: PaymentInput): Promise<PaymentResult> {
  return mutate(apiFetch<PaymentResult>("/api/payroll/payments", { method: "POST", json: input }));
}

/** GET /api/payroll/employees/{id}/salary-dues (salary_advances) */
export async function getSalaryDues(employee_id: number): Promise<SalaryDues> {
  return apiFetch<SalaryDues>(`/api/payroll/employees/${employee_id}/salary-dues`);
}

/**
 * POST /api/payroll/salary-payments -> 201: the amount split oldest month first, one receipt
 * (422 code over_total with `cap` when above the total due).
 */
export async function paySalary(input: SalaryPaymentInput): Promise<SalaryPaymentResult> {
  return mutate(apiFetch<SalaryPaymentResult>("/api/payroll/salary-payments", { method: "POST", json: input }));
}

/**
 * POST /api/payroll/payments/{id}/void {reason} - admins only, cannot be undone. The payment stays
 * listed (struck through, "Voided — reason") and keeps its receipt number, but counts for nothing.
 */
export async function voidPayment(payment_id: number, reason: string): Promise<Payment> {
  return mutate(apiFetch<Payment>(`/api/payroll/payments/${payment_id}/void`, { method: "POST", json: { reason } }));
}

/** PATCH /api/payroll/payments/{id}/note - the human note for the whole payment group; "" clears it. */
export async function updatePaymentNote(payment_id: number, note: string): Promise<Payment> {
  return mutate(apiFetch<Payment>(`/api/payroll/payments/${payment_id}/note`, { method: "PATCH", json: { note } }));
}

export interface PaymentsQuery {
  /** BS dates, inclusive; null = no bound. */
  from_bs: string | null;
  to_bs: string | null;
  type: RegisterTypeFilter;
  employee_id?: number | null;
  /** Only payments of employees in this branch (null / omitted = all branches the caller may see). */
  branch_id?: number | null;
  department_id?: number | null;
  /** Row order; "date" (newest first) when omitted. */
  sort?: RegisterSort;
  /** List voided payments too (struck through). The screen only; exports never include them. */
  show_voided?: boolean;
}

function registerQuery(query: PaymentsQuery, forExport = false): string {
  return qs({
    from: query.from_bs,
    to: query.to_bs,
    type: query.type === "all" ? null : query.type,
    employee_id: query.employee_id,
    branch_id: query.branch_id,
    department_id: query.department_id,
    sort: query.sort,
    show_voided: !forExport && query.show_voided ? "true" : null,
  });
}

/** GET /api/payroll/payments?from=&to=&type=&employee_id=&branch_id=&department_id=&sort= */
export async function listPayments(query: PaymentsQuery): Promise<PaymentsRegister> {
  return apiFetch<PaymentsRegister>(`/api/payroll/payments${registerQuery(query)}`);
}

/** URL of the register's Excel / PDF file for the same filters (opened by the browser). */
export function registerExportUrl(query: PaymentsQuery, ext: "xlsx" | "pdf"): string {
  return `/api/payroll/payments/export.${ext}${registerQuery(query, true)}`;
}

/** URL of a payment's receipt PDF. */
export function receiptUrl(payment_id: number): string {
  return `/api/payroll/payments/${payment_id}/receipt.pdf`;
}

/** URL of an employee's payslip PDF for a month. */
export function payslipUrl(employee_id: number, month: BsMonth): string {
  return `/api/payroll/employees/${employee_id}/payslips/${key(month)}.pdf`;
}

/** GET /api/payroll/employees/{id}/transactions - the running ledger, oldest first. */
export async function getEmployeeLedger(employee_id: number): Promise<EmployeeLedger> {
  return apiFetch<EmployeeLedger>(`/api/payroll/employees/${employee_id}/transactions`);
}

/** GET /api/payroll/employees/{id}/summary - what the Give advance / Pay salary dialogs show. */
export async function getAccountSummary(employee_id: number): Promise<AccountSummary> {
  return apiFetch<AccountSummary>(`/api/payroll/employees/${employee_id}/summary`);
}

// ----------------------------------------------------------------- report

/** GET /api/payroll/report/{YYYY-MM}?department_id=&branch_id= */
export async function getSalaryReport(month: BsMonth, department_id: number | null = null, branch_id: number | null = null): Promise<SalaryReport> {
  return apiFetch<SalaryReport>(`/api/payroll/report/${key(month)}${qs({ department_id, branch_id })}`);
}

/** URL of the salary report's Excel / PDF file for the same filters. */
export function salaryReportExportUrl(month: BsMonth, ext: "xlsx" | "pdf", department_id: number | null = null, branch_id: number | null = null): string {
  return `/api/payroll/report/${key(month)}.${ext}${qs({ department_id, branch_id })}`;
}

// ------------------------------------------------------------------ photo

/** POST /api/payroll/photo-tokens {employee_id, origin} - a single-use 15-minute link for the QR code. */
export async function createPhotoToken(employee_id: number, origin: string): Promise<PhotoToken> {
  return apiFetch<PhotoToken>("/api/payroll/photo-tokens", { method: "POST", json: { employee_id, origin } });
}

/** GET /api/payroll/photo-tokens/{token} (no session; 410 when used or expired) */
export async function resolvePhotoToken(token: string): Promise<PhotoTokenInfo> {
  return apiFetch<PhotoTokenInfo>(`/api/payroll/photo-tokens/${encodeURIComponent(token)}`, { redirectOn401: false });
}

/** POST /api/payroll/photo-tokens/{token}/photo (no session; burns the token) */
export async function uploadPhotoByToken(token: string, photo: string): Promise<Employee> {
  return mutate(
    apiFetch<Employee>(`/api/payroll/photo-tokens/${encodeURIComponent(token)}/photo`, {
      method: "POST",
      json: { photo_data_url: photo },
      redirectOn401: false,
    }),
  );
}
