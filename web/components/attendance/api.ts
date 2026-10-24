/**
 * Attendance API client. Pages call only these functions.
 *
 * UI-first pass: every function resolves from in-memory mock data shaped
 * exactly like the future FastAPI responses (see types.ts). After UI sign-off
 * each body becomes an `apiFetch("/api/attendance/…")` call; the endpoint for
 * each function is noted above it and collected in
 * app/modules/attendance/API_NOTES.md.
 *
 * The two payroll functions at the bottom are the only way attendance touches
 * payments: they are the client of a contract the PAYROLL module implements.
 */

import { monthLabel, parseMonthKey } from "./bsdate";
import { dayFromBs, findMonth, listMonths as calendarMonths, todayRef } from "./calendar";
import { buildExportModel, type ExportContext } from "./exportModel";
import { computeTotals, findByCode } from "./helpers";
import { EMPLOYEES, branchRefs, departmentRefs } from "./mock/employees";
import { MOCK_SETTINGS, addPayment, getBalance, getPaymentHistory, getRecord, putMarks } from "./mock/store";
import { buildPrintDocument } from "./print";
import type {
  DayAttendance,
  DayCell,
  ExportFile,
  LookupResponse,
  MarkInput,
  MarkRow,
  MonthBalance,
  MonthOption,
  PaymentHistory,
  MonthReport,
  PaymentInput,
  PaymentResult,
  ReportFilters,
  ReportRow,
  SaveDayRequest,
  SaveDayResponse,
  ScanRequest,
  ScanResponse,
  TodayRef,
} from "./types";
import { OT_MAX, OT_MIN } from "./types";
import { buildReportWorkbook, workbookToBlob } from "./xlsx";

/** Small, deterministic delay so loading states are exercised. */
const LATENCY_MS = 80;
const wait = () => new Promise<void>((resolve) => setTimeout(resolve, LATENCY_MS));

export class AttendanceApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AttendanceApiError";
    this.status = status;
  }
}

function checkMark(mark: MarkInput): void {
  if (mark.status === "O") {
    if (!Number.isInteger(mark.ot_hours) || mark.ot_hours < OT_MIN || mark.ot_hours > OT_MAX) {
      throw new AttendanceApiError(422, `Overtime hours must be whole hours from ${OT_MIN} to ${OT_MAX}.`);
    }
  } else if (mark.ot_hours) {
    throw new AttendanceApiError(422, "Only an Overtime mark can carry hours.");
  }
}

// ------------------------------------------------------------ today

/** GET /api/today (core). `bs` is null there until the BS table is installed; the UI converts locally meanwhile. */
export async function getToday(): Promise<TodayRef> {
  await wait();
  return todayRef();
}

// ------------------------------------------------------------ marking

/** GET /api/attendance/day?date_bs=<YYYY-MM-DD>&branch=<id> -> DayAttendance */
export async function getDay(dateBs: string, branchId: number): Promise<DayAttendance> {
  await wait();
  const day = dayFromBs(dateBs, MOCK_SETTINGS.weekly_off);
  if (!day) throw new AttendanceApiError(422, `${dateBs} is not a valid BS date.`);
  const rows: MarkRow[] = EMPLOYEES.filter((e) => e.branch_id === branchId).map((employee) => ({
    employee,
    record: getRecord(employee.id, day),
  }));
  return {
    day,
    settings: MOCK_SETTINGS,
    branches: branchRefs(),
    departments: departmentRefs(branchId),
    rows,
  };
}

/** PUT /api/attendance/day  body SaveDayRequest -> SaveDayResponse (all rows or none; CSRF header). */
export async function saveDay(request: SaveDayRequest): Promise<SaveDayResponse> {
  await wait();
  const day = dayFromBs(request.date_bs, MOCK_SETTINGS.weekly_off);
  if (!day) throw new AttendanceApiError(422, `${request.date_bs} is not a valid BS date.`);
  // The weekly off needs no marks, but someone who came in can still be marked (e.g. overtime).
  for (const mark of request.rows) checkMark(mark); // validate everything before writing anything
  const records = putMarks(day, request.rows, "admin", "manual");
  return { saved: records.length, records };
}

/** GET /api/attendance/lookup?code=TTK-E004 -> LookupResponse (404 when no active employee has that code). */
export async function lookupCode(code: string): Promise<LookupResponse> {
  await wait();
  const employee = findByCode(EMPLOYEES, code);
  if (!employee) throw new AttendanceApiError(404, `No employee for code ${code.trim() || "(empty)"}.`);
  const today = dayFromBs(todayRef().bs_date, MOCK_SETTINGS.weekly_off)!;
  return { code: code.trim(), employee, today: getRecord(employee.id, today) };
}

/** POST /api/attendance/scan {code, action, ot_hours} -> ScanResponse (marks today at once, marked_via "scan"). */
export async function scanMark(request: ScanRequest): Promise<ScanResponse> {
  await wait();
  const employee = findByCode(EMPLOYEES, request.code);
  if (!employee) throw new AttendanceApiError(404, `No employee for code ${request.code}.`);
  const today = dayFromBs(todayRef().bs_date, MOCK_SETTINGS.weekly_off)!;
  const mark: MarkInput = {
    employee_id: employee.id,
    status: request.action === "overtime" ? "O" : "P",
    ot_hours: request.action === "overtime" ? request.ot_hours : 0,
    note: getRecord(employee.id, today)?.note ?? "",
  };
  checkMark(mark);
  const [record] = putMarks(today, [mark], "admin", "scan");
  return { employee, record };
}

// ------------------------------------------------------------ report

/** Months the report select offers: computed in the browser from today (no endpoint needed). */
export async function listMonths(): Promise<MonthOption[]> {
  await wait();
  return calendarMonths();
}

/** GET /api/attendance/report?bs_year=&bs_month= -> MonthReport (all departments; week/dept are sliced client-side). */
export async function getReport(monthKey: string): Promise<MonthReport> {
  await wait();
  const month = findMonth(monthKey, MOCK_SETTINGS.weekly_off);
  if (!month) throw new AttendanceApiError(404, `No report for ${monthKey}.`);
  const rows: ReportRow[] = EMPLOYEES.map((employee) => {
    const cells: DayCell[] = month.days.map((day) => {
      // A weekly-off day without a record is "–"; a record on it (overtime on a Saturday) shows as marked.
      const record = getRecord(employee.id, day);
      if (record) return { status: record.status, ot_hours: record.ot_hours };
      return { status: day.is_weekly_off ? "W" : "N", ot_hours: 0 };
    });
    return { employee, cells, totals: computeTotals(cells) };
  });
  return {
    month,
    settings: MOCK_SETTINGS,
    departments: departmentRefs(),
    rows,
    generated_at: new Date().toISOString(),
  };
}

/**
 * GET /api/attendance/report/export.xlsx?bs_year=&bs_month=&dept=&q=&sort=  -> file (openpyxl)
 * GET /api/attendance/report/export.pdf?bs_year=&bs_month=&dept=&q=&sort=   -> file (WeasyPrint)
 *
 * UI-first pass: the file is produced in the browser from the same report
 * data. The PDF variant returns a print-ready HTML document that the caller
 * opens and prints (A4 landscape); the backend renders the same layout.
 */
export async function exportReport(
  format: "xlsx" | "pdf",
  filters: ReportFilters,
  context: ExportContext,
): Promise<ExportFile> {
  const report = await getReport(filters.month);
  const model = buildExportModel(report, filters, context);
  const slug = report.month.label.replace(/\s+/g, "_");
  if (format === "xlsx") {
    return {
      filename: `Attendance_${slug}.xlsx`,
      blob: workbookToBlob(buildReportWorkbook(model)),
    };
  }
  return {
    filename: `Attendance_${slug}.pdf`,
    blob: new Blob([buildPrintDocument(model)], { type: "text/html;charset=utf-8" }),
  };
}

// ------------------------------------------------------------ payroll client (contract)

function labelOf(monthKey: string): string {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) throw new AttendanceApiError(422, `Bad month ${monthKey}.`);
  return monthLabel(parsed.year, parsed.month);
}

/** PAYROLL: GET /api/payroll/balance?employee_id=&bs_year=&bs_month= -> MonthBalance */
export async function getMonthBalance(employeeId: number, monthKey: string): Promise<MonthBalance> {
  await wait();
  if (!EMPLOYEES.some((e) => e.id === employeeId)) {
    throw new AttendanceApiError(404, "Unknown employee.");
  }
  return getBalance(employeeId, monthKey, labelOf(monthKey));
}

/** PAYROLL: GET /api/payroll/payments?employee_id=&bs_year=&bs_month= -> PaymentHistory (newest first, with month totals). */
export async function getPaymentHistoryFor(employeeId: number, monthKey: string): Promise<PaymentHistory> {
  await wait();
  if (!EMPLOYEES.some((e) => e.id === employeeId)) {
    throw new AttendanceApiError(404, "Unknown employee.");
  }
  return getPaymentHistory(employeeId, monthKey, labelOf(monthKey));
}

/** PAYROLL: POST /api/payroll/payments  body PaymentInput -> PaymentResult (422 when amount is 0 or above the balance due). */
export async function recordPayment(input: PaymentInput): Promise<PaymentResult> {
  await wait();
  const label = labelOf(input.month_key);
  const balance = getBalance(input.employee_id, input.month_key, label);
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new AttendanceApiError(422, "Enter an amount above 0.");
  }
  if (input.amount > balance.due) {
    throw new AttendanceApiError(422, `More than the balance due for ${label}.`);
  }
  return addPayment(input, label);
}
