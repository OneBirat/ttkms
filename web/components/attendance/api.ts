/**
 * Attendance API client - the real one, over /api/attendance (app/modules/attendance) and,
 * for the scan flow's payment step, payroll's endpoints (/api/payroll/...). Pages call only
 * these functions; the shapes are types.ts (same field names as the FastAPI schemas). The
 * in-memory twin for the node tests is `mock/mockApi.ts`.
 *
 * The month report's Excel and PDF are still built in the browser from `getReport` (xlsx.ts,
 * print.ts), so they always show exactly what the screen shows.
 */

import { ApiError, apiFetch } from "@/lib/api";
import { monthLabel, parseMonthKey } from "@/lib/bs";
import { listMonths as calendarMonths, todayRef } from "./calendar";
import { buildExportModel, type ExportContext } from "./exportModel";
import { buildPrintDocument } from "./print";
import type {
  BulkMarkRequest,
  BulkMarkResponse,
  ClearMarkResponse,
  DayAttendance,
  EmployeeMonth,
  ExportFile,
  LookupResponse,
  MarkOneRequest,
  MarkOneResponse,
  MonthBalance,
  MonthOption,
  MonthReport,
  PaymentHistory,
  PaymentInput,
  PaymentKind,
  PaymentRecord,
  PaymentResult,
  ReportFilters,
  ScanRequest,
  ScanResponse,
  TodayRef,
} from "./types";
import { CASH_PAYMENT_MODE_ID } from "./types";
import { buildReportWorkbook, workbookToBlob } from "./xlsx";

/** Errors carry the HTTP status (`isNotFound` in scan/scanFlow.ts reads it). */
export { ApiError as AttendanceApiError };

function qs(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

function monthParts(monthKey: string): { year: number; month: number } {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) throw new ApiError(422, `Bad month ${monthKey}.`);
  return parsed;
}

// ------------------------------------------------------------ today

/** Today in Kathmandu, BS first - computed from the shared BS table (web/lib/bs, same as the server). */
export async function getToday(): Promise<TodayRef> {
  return todayRef();
}

// ------------------------------------------------------------ marking

/** GET /api/attendance/day?date_bs=&branch= -> DayAttendance (the branch is ignored without see_other_branches). */
export async function getDay(dateBs: string, branchId: number): Promise<DayAttendance> {
  return apiFetch<DayAttendance>(`/api/attendance/day${qs({ date_bs: dateBs, branch: branchId })}`);
}

/** POST /api/attendance/mark -> MarkOneResponse (upsert on employee + day). */
export async function markOne(request: MarkOneRequest): Promise<MarkOneResponse> {
  return apiFetch<MarkOneResponse>("/api/attendance/mark", {
    method: "POST",
    json: { ...request, ot_hours: request.status === "O" ? request.ot_hours : 0 },
  });
}

/** DELETE /api/attendance/mark?employee_id=&date_bs= -> ClearMarkResponse ("Clear mark"). */
export async function clearMark(employeeId: number, dateBs: string): Promise<ClearMarkResponse> {
  return apiFetch<ClearMarkResponse>(`/api/attendance/mark${qs({ employee_id: employeeId, date_bs: dateBs })}`, {
    method: "DELETE",
  });
}

/** POST /api/attendance/bulk-mark -> BulkMarkResponse (Present for the still-unmarked only, one transaction). */
export async function bulkMarkPresent(request: BulkMarkRequest): Promise<BulkMarkResponse> {
  return apiFetch<BulkMarkResponse>("/api/attendance/bulk-mark", { method: "POST", json: request });
}

interface BarcodeEmployee {
  id: number;
}

/**
 * The scanned / typed code: payroll's GET /api/payroll/employees/by-barcode/{code} resolves it
 * (TTK-E001, legacy TTK-E-001, E-001, 1), then GET /api/attendance/lookup?employee_id= gives
 * today's record. 404 when no active employee matches.
 */
export async function lookupCode(code: string): Promise<LookupResponse> {
  const raw = code.trim();
  if (!raw) throw new ApiError(404, "No employee for code (empty).");
  const found = await apiFetch<BarcodeEmployee>(`/api/payroll/employees/by-barcode/${encodeURIComponent(raw)}`);
  const lookup = await apiFetch<LookupResponse>(`/api/attendance/lookup${qs({ employee_id: found.id })}`);
  return { ...lookup, code: raw };
}

/** POST /api/attendance/scan {employee_id, action, ot_hours} -> ScanResponse (today, marked_via "scan"). */
export async function scanMark(request: ScanRequest): Promise<ScanResponse> {
  return apiFetch<ScanResponse>("/api/attendance/scan", {
    method: "POST",
    json: {
      employee_id: request.employee_id,
      action: request.action,
      ot_hours: request.action === "overtime" ? request.ot_hours : 0,
    },
  });
}

// ------------------------------------------------------------ report

/** Months the report select offers: computed in the browser from today (no endpoint needed). */
export async function listMonths(): Promise<MonthOption[]> {
  return calendarMonths();
}

/** GET /api/attendance/report?bs_year=&bs_month=&branch= -> MonthReport (null branch = every branch, admins). */
export async function getReport(monthKey: string, branchId: number | null = null): Promise<MonthReport> {
  const { year, month } = monthParts(monthKey);
  return apiFetch<MonthReport>(`/api/attendance/report${qs({ bs_year: year, bs_month: month, branch: branchId })}`);
}

/** GET /api/attendance/employees/{id}/month?bs_year=&bs_month= -> EmployeeMonth (attendance record sheet). */
export async function getEmployeeMonth(employeeId: number, monthKey: string): Promise<EmployeeMonth> {
  const { year, month } = monthParts(monthKey);
  return apiFetch<EmployeeMonth>(`/api/attendance/employees/${employeeId}/month${qs({ bs_year: year, bs_month: month })}`);
}

/** GET /api/attendance/marked-days -> BS dates with a mark (BSDatePicker dots). */
export async function getMarkedDays(monthKey: string, options: { branchId?: number; employeeId?: number } = {}): Promise<string[]> {
  const { year, month } = monthParts(monthKey);
  const body = await apiFetch<{ marked_days: string[] }>(
    `/api/attendance/marked-days${qs({ bs_year: year, bs_month: month, branch: options.branchId, employee_id: options.employeeId })}`,
  );
  return body.marked_days;
}

/**
 * The report's Excel / PDF, built in the browser from the same report data (xlsx.ts, print.ts).
 * The PDF variant is a print-ready HTML document (A4 landscape) the caller opens and prints.
 */
export async function exportReport(format: "xlsx" | "pdf", filters: ReportFilters, context: ExportContext): Promise<ExportFile> {
  const report = await getReport(filters.month, filters.branch_id);
  const model = buildExportModel(report, filters, context);
  const slug = report.month.label.replace(/\s+/g, "_");
  if (format === "xlsx") {
    return { filename: `Attendance_${slug}.xlsx`, blob: workbookToBlob(buildReportWorkbook(model)) };
  }
  return {
    filename: `Attendance_${slug}.pdf`,
    blob: new Blob([buildPrintDocument(model)], { type: "text/html;charset=utf-8" }),
  };
}

// ------------------------------------------------------------ payroll (scan flow's payment step)

/** /api/payroll/balance answers with for_year / for_month. */
interface PayrollBalance {
  employee_id: number;
  for_year: number;
  for_month: number;
  month_key: string;
  month_label: string;
  earned: number;
  paid: number;
  due: number;
}

/** /api/payroll PaymentOut. */
interface PayrollPayment {
  id: number;
  receipt_no: string;
  employee_id: number;
  kind: PaymentKind;
  for_year: number;
  for_month: number;
  amount: number;
  payment_mode_id: number;
  payment_mode: { id: number; type: string; name: string };
  note: string | null;
  date: { bs: string; ad: string };
  paid_at: string;
  source: "scan" | "account";
  /** Voided payments count for nothing; the scan sheets leave them out. */
  voided?: boolean;
}

function paymentRecord(p: PayrollPayment): PaymentRecord {
  return {
    payment_id: p.id,
    receipt_no: p.receipt_no,
    employee_id: p.employee_id,
    for_year: p.for_year,
    for_month: p.for_month,
    kind: p.kind,
    amount: p.amount,
    payment_mode_id: p.payment_mode_id,
    payment_mode: p.payment_mode.name,
    date: p.date.ad,
    date_bs: p.date.bs,
    note: p.note ?? "",
    source: p.source,
    recorded_at: p.paid_at,
  };
}

/** PAYROLL: GET /api/payroll/balance?employee_id=&for_year=&for_month= -> MonthBalance */
export async function getMonthBalance(employeeId: number, monthKey: string): Promise<MonthBalance> {
  const { year, month } = monthParts(monthKey);
  const b = await apiFetch<PayrollBalance>(`/api/payroll/balance${qs({ employee_id: employeeId, for_year: year, for_month: month })}`);
  return {
    employee_id: b.employee_id,
    bs_year: b.for_year,
    bs_month: b.for_month,
    month_key: b.month_key,
    month_label: b.month_label,
    earned: b.earned,
    paid: b.paid,
    due: b.due,
  };
}

/**
 * PAYROLL: the month a salary payment from the scanner counts for - payroll's settlement month
 * (the previous BS month while anything is still due for it, else the running month), from
 * GET /api/payroll/employees/{id}/summary.
 */
export async function getSalaryMonthKey(employeeId: number): Promise<string> {
  const summary = await apiFetch<{ salary_month: { bs_year: number; bs_month: number } }>(
    `/api/payroll/employees/${employeeId}/summary`,
  );
  const { bs_year, bs_month } = summary.salary_month;
  return `${bs_year}-${String(bs_month).padStart(2, "0")}`;
}

/** PAYROLL: GET /api/payroll/employees/{id}/ledger/{YYYY-MM} -> PaymentHistory (newest first, with the month's balance). */
export async function getPaymentHistoryFor(employeeId: number, monthKey: string): Promise<PaymentHistory> {
  const { year, month } = monthParts(monthKey);
  const label = `${monthLabel(year, month)}`;
  try {
    const ledger = await apiFetch<{ net: number; paid: number; due: number; payments: PayrollPayment[] }>(
      `/api/payroll/employees/${employeeId}/ledger/${monthKey}`,
    );
    return {
      employee_id: employeeId,
      month_key: monthKey,
      month_label: label,
      payments: ledger.payments.filter((p) => !p.voided).map(paymentRecord).reverse(),
      totals: { earned: ledger.net, paid: ledger.paid, due: ledger.due },
    };
  } catch (err) {
    // Before the joining month or without a salary yet: nothing earned, nothing paid.
    if (err instanceof ApiError && err.status === 404) {
      return { employee_id: employeeId, month_key: monthKey, month_label: label, payments: [], totals: { earned: 0, paid: 0, due: 0 } };
    }
    throw err;
  }
}

/**
 * PAYROLL: POST /api/payroll/payments -> PaymentResult (422 with the payroll message when the
 * amount is 0 or above what can be paid). No for_* = the BS month of the payment date.
 */
export async function recordPayment(input: PaymentInput): Promise<PaymentResult> {
  const result = await apiFetch<{ payment: PayrollPayment; due_after: number }>("/api/payroll/payments", {
    method: "POST",
    json: {
      employee_id: input.employee_id,
      kind: input.kind,
      amount: input.amount,
      payment_mode_id: input.payment_mode_id ?? CASH_PAYMENT_MODE_ID,
      date_bs: input.date_bs ?? undefined,
      for_year: input.for_year ?? undefined,
      for_month: input.for_month ?? undefined,
      note: input.note || undefined,
      source: input.source,
    },
  });
  return { payment: paymentRecord(result.payment), due_after: result.due_after };
}
