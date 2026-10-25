/**
 * In-memory twin of ../api.ts for the node unit tests only (the pages use the real client).
 * Same function names and shapes as the FastAPI endpoints (types.ts); the endpoint each one
 * stands for is noted above it.
 */

import { isValidBs, monthLabel, parseMonthKey, todayBs } from "@/lib/bs";
import { dayFromBs, findMonth, listMonths as calendarMonths, todayRef } from "../calendar";
import { loadDepartments } from "../departments";
import { buildExportModel, type ExportContext } from "../exportModel";
import { computeTotals, findByCode } from "../helpers";
import { EMPLOYEES, branchRefs, departmentRefs } from "./employees";
import { MOCK_SETTINGS, addPayment, getBalance, getPaymentHistory, getRecord, putMarks } from "./store";
import { buildPrintDocument } from "../print";
import type {
  BulkMarkRequest,
  BulkMarkResponse,
  DayAttendance,
  DayCell,
  EmployeeMonth,
  ExportFile,
  LookupResponse,
  MarkInput,
  MarkOneRequest,
  MarkOneResponse,
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
} from "../types";
import { OT_MAX, OT_MIN } from "../types";
import { buildReportWorkbook, workbookToBlob } from "../xlsx";

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
    departments: departmentRefs(branchId, await loadDepartments()), // real core departments
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

/** POST /api/attendance/mark  body MarkOneRequest -> MarkOneResponse (upsert on employee + day; CSRF header). */
export async function markOne(request: MarkOneRequest): Promise<MarkOneResponse> {
  await wait();
  const day = dayFromBs(request.date_bs, MOCK_SETTINGS.weekly_off);
  if (!day) throw new AttendanceApiError(422, `${request.date_bs} is not a valid BS date.`);
  if (!EMPLOYEES.some((e) => e.id === request.employee_id)) {
    throw new AttendanceApiError(404, "Unknown employee.");
  }
  const mark: MarkInput = {
    employee_id: request.employee_id,
    status: request.status,
    ot_hours: request.status === "O" ? request.ot_hours : 0,
    note: request.note ?? getRecord(request.employee_id, day)?.note ?? "",
  };
  checkMark(mark);
  const previous = getRecord(request.employee_id, day)?.status ?? "N";
  const [record] = putMarks(day, [mark], "admin", "manual");
  return { record, previous };
}

/**
 * POST /api/attendance/bulk-mark  body BulkMarkRequest -> BulkMarkResponse.
 * One transaction; only employees without a record that day are written, the
 * rest are reported in `skipped`.
 */
export async function bulkMarkPresent(request: BulkMarkRequest): Promise<BulkMarkResponse> {
  await wait();
  const day = dayFromBs(request.date_bs, MOCK_SETTINGS.weekly_off);
  if (!day) throw new AttendanceApiError(422, `${request.date_bs} is not a valid BS date.`);
  if (!request.employee_ids && request.department_id === undefined) {
    throw new AttendanceApiError(422, "Give employee_ids or a department_id.");
  }
  const scope = EMPLOYEES.filter(
    (e) =>
      e.branch_id === request.branch_id &&
      (request.department_id === undefined || e.department_id === request.department_id) &&
      (!request.employee_ids || request.employee_ids.includes(e.id)),
  );
  const open = scope.filter((e) => !getRecord(e.id, day));
  const skipped = scope.filter((e) => getRecord(e.id, day)).map((e) => e.id);
  const records = putMarks(
    day,
    open.map((e) => ({ employee_id: e.id, status: "P" as const, ot_hours: 0, note: "" })),
    "admin",
    "manual",
  );
  return { marked: open.map((e) => ({ employee_id: e.id, name: e.name })), skipped, records };
}

/** GET /api/attendance/lookup?code=TTK-E004 -> LookupResponse (404 when no active employee has that code). */
export async function lookupCode(code: string): Promise<LookupResponse> {
  await wait();
  const employee = findByCode(EMPLOYEES, code);
  if (!employee) throw new AttendanceApiError(404, `No employee for code ${code.trim() || "(empty)"}.`);
  const today = dayFromBs(todayRef().bs_date, MOCK_SETTINGS.weekly_off)!;
  return { code: code.trim(), employee, today: getRecord(employee.id, today) };
}

/** POST /api/attendance/scan {employee_id, action, ot_hours} -> ScanResponse (marks today at once, marked_via "scan"). */
export async function scanMark(request: ScanRequest): Promise<ScanResponse> {
  await wait();
  const employee =
    EMPLOYEES.find((e) => e.id === request.employee_id) ?? (request.code ? findByCode(EMPLOYEES, request.code) : undefined);
  if (!employee) throw new AttendanceApiError(404, `No employee for code ${request.code ?? request.employee_id}.`);
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

function monthCells(employeeId: number, month: MonthReport["month"]): DayCell[] {
  const paid = new Map<string, { advance: number; salary: number }>();
  for (const p of getPaymentHistory(employeeId, month.key, month.label).payments) {
    const slot = paid.get(p.date_bs) ?? { advance: 0, salary: 0 };
    slot[p.kind] += p.amount;
    paid.set(p.date_bs, slot);
  }
  return month.days.map((day) => {
    // A weekly-off day without a record is "–"; a record on it (overtime on a Saturday) shows as marked.
    const record = getRecord(employeeId, day);
    const cell: DayCell = record
      ? { status: record.status, ot_hours: record.ot_hours }
      : { status: day.is_weekly_off ? "W" : "N", ot_hours: 0 };
    const money = paid.get(day.bs_date);
    if (money?.advance) cell.advance = money.advance;
    if (money?.salary) cell.salary = money.salary;
    return cell;
  });
}

/**
 * GET /api/attendance/report?bs_year=&bs_month=&branch= -> MonthReport.
 * `branch` is required unless the user has see_other_branches; without it an
 * admin gets every branch. Week / day / department views are sliced client-side.
 */
export async function getReport(monthKey: string, branchId: number | null = null): Promise<MonthReport> {
  await wait();
  const month = findMonth(monthKey, MOCK_SETTINGS.weekly_off);
  if (!month) throw new AttendanceApiError(404, `No report for ${monthKey}.`);
  if (branchId !== null && !branchRefs().some((b) => b.id === branchId)) {
    throw new AttendanceApiError(404, "Unknown branch.");
  }
  const rows: ReportRow[] = EMPLOYEES.filter((e) => branchId === null || e.branch_id === branchId).map((employee) => {
    const cells = monthCells(employee.id, month);
    return { employee, cells, totals: computeTotals(cells) };
  });
  return {
    month,
    settings: MOCK_SETTINGS,
    branches: branchRefs(),
    departments: departmentRefs(branchId, await loadDepartments()), // real core departments
    rows,
    generated_at: new Date().toISOString(),
  };
}

/** GET /api/attendance/employees/{id}/month?bs_year=&bs_month= -> EmployeeMonth (attendance record sheet). */
export async function getEmployeeMonth(employeeId: number, monthKey: string): Promise<EmployeeMonth> {
  await wait();
  const employee = EMPLOYEES.find((e) => e.id === employeeId);
  if (!employee) throw new AttendanceApiError(404, "Unknown employee.");
  const month = findMonth(monthKey, MOCK_SETTINGS.weekly_off);
  if (!month) throw new AttendanceApiError(404, `No month ${monthKey}.`);
  const cells = monthCells(employeeId, month);
  return {
    employee,
    month,
    cells,
    totals: computeTotals(cells),
    payments: getPaymentHistory(employeeId, monthKey, month.label).payments,
  };
}

/**
 * GET /api/attendance/report/export.xlsx?bs_year=&bs_month=&branch=&dept=&q=&sort=                -> file (openpyxl)
 * GET /api/attendance/report/export.pdf?bs_year=&bs_month=&branch=&dept=&q=&sort=&hide_saturdays= -> file (WeasyPrint)
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
  const report = await getReport(filters.month, filters.branch_id);
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

/** PAYROLL: GET /api/payroll/payments?employee_id=&bs_year=&bs_month= -> PaymentHistory (newest first, with the month's balance). */
export async function getPaymentHistoryFor(employeeId: number, monthKey: string): Promise<PaymentHistory> {
  await wait();
  if (!EMPLOYEES.some((e) => e.id === employeeId)) {
    throw new AttendanceApiError(404, "Unknown employee.");
  }
  return getPaymentHistory(employeeId, monthKey, labelOf(monthKey));
}

/**
 * PAYROLL: POST /api/payroll/payments  body PaymentInput -> PaymentResult
 * (422 when amount is 0 or above the balance due). The payment counts for
 * `for_year` / `for_month`, else the BS month of `date_bs` (today when omitted)
 * - app/contracts.py PaymentInput.
 */
export async function recordPayment(input: PaymentInput): Promise<PaymentResult> {
  await wait();
  if (!EMPLOYEES.some((e) => e.id === input.employee_id)) {
    throw new AttendanceApiError(404, "Unknown employee.");
  }
  const dateBs = input.date_bs ?? todayBs();
  if (!isValidBs(dateBs)) throw new AttendanceApiError(422, `${dateBs} is not a valid BS date.`);
  if ((input.for_year == null) !== (input.for_month == null)) {
    throw new AttendanceApiError(422, "for_year and for_month go together.");
  }
  const monthKey =
    input.for_year != null && input.for_month != null
      ? `${input.for_year}-${String(input.for_month).padStart(2, "0")}`
      : dateBs.slice(0, 7);
  const label = labelOf(monthKey);
  const balance = getBalance(input.employee_id, monthKey, label);
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new AttendanceApiError(422, "Enter an amount above 0.");
  }
  if (input.amount > balance.due) {
    throw new AttendanceApiError(422, `More than the balance due for ${label}.`);
  }
  return addPayment(input, dateBs, monthKey, label);
}
