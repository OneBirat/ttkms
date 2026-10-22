/**
 * Attendance API client. Pages call only these functions.
 *
 * UI-only session: every function resolves from in-memory mock data shaped
 * exactly like the future FastAPI responses (see types.ts). Next session each
 * body becomes an `apiFetch("/api/attendance/…")` call — the endpoint for each
 * function is noted above it.
 */

import type {
  DayAttendance,
  ExportFile,
  MarkRow,
  MonthOption,
  MonthReport,
  ReportFilters,
  ReportRow,
  SaveDayRequest,
  SaveDayResponse,
  TodayRef,
} from "./types";
import { computeTotals } from "./helpers";
import { buildExportModel, type ExportContext } from "./exportModel";
import { buildReportWorkbook, workbookToBlob } from "./xlsx";
import { buildPrintDocument } from "./print";
import {
  dayFromBs,
  findMonth,
  listMonths as mockListMonths,
  mockToday,
} from "./mock/calendar";
import { EMPLOYEES, branchRefs, departmentRefs } from "./mock/employees";
import { MOCK_SETTINGS, getRecord, putMarks } from "./mock/store";

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

const EMPLOYEE_IDS = EMPLOYEES.map((e) => e.id);

/** GET /api/today (already exists in core; `bs` is null until the BS table lands). */
export async function getToday(): Promise<TodayRef> {
  await wait();
  return mockToday();
}

/** GET /api/attendance/day?date=<bs YYYY-MM-DD>&branch_id=<id> -> DayAttendance */
export async function getDay(bsDate: string, branchId: number): Promise<DayAttendance> {
  await wait();
  const day = dayFromBs(bsDate);
  if (!day) throw new AttendanceApiError(422, `No calendar data for ${bsDate} (mock months only).`);
  const employees = EMPLOYEES.filter((e) => e.branch_id === branchId);
  const rows: MarkRow[] = employees.map((employee) => ({
    employee,
    record: getRecord(employee.id, day, EMPLOYEE_IDS),
  }));
  return {
    day,
    settings: MOCK_SETTINGS,
    branches: branchRefs(),
    departments: departmentRefs(branchId),
    rows,
  };
}

/** POST /api/attendance/day  body SaveDayRequest -> SaveDayResponse (CSRF header required). */
export async function saveDay(request: SaveDayRequest): Promise<SaveDayResponse> {
  await wait();
  const day = dayFromBs(request.date);
  if (!day) throw new AttendanceApiError(422, `No calendar data for ${request.date}.`);
  if (day.is_weekly_off) {
    throw new AttendanceApiError(422, "That day is the weekly off; nothing to mark.");
  }
  const records = putMarks(day, request.marks, "admin", EMPLOYEE_IDS);
  return { saved: records.length, records };
}

/** GET /api/attendance/months -> MonthOption[] (months with data, newest last). */
export async function listMonths(): Promise<MonthOption[]> {
  await wait();
  return mockListMonths();
}

/** GET /api/attendance/report?month=<YYYY-MM> -> MonthReport (all departments; filter client-side). */
export async function getReport(monthKey: string): Promise<MonthReport> {
  await wait();
  const month = findMonth(monthKey);
  if (!month) throw new AttendanceApiError(404, `No report for ${monthKey}.`);
  const rows: ReportRow[] = EMPLOYEES.map((employee) => {
    const cells = month.days.map((day) => {
      if (day.is_weekly_off) return { status: "weekly_off" as const, in_time: null, out_time: null };
      const record = getRecord(employee.id, day, EMPLOYEE_IDS);
      return record
        ? { status: record.status, in_time: record.in_time, out_time: record.out_time }
        : { status: "not_marked" as const, in_time: null, out_time: null };
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
 * GET /api/attendance/report.xlsx?month=&department_id=&q=&sort=   -> file
 * GET /api/attendance/report.pdf?month=&department_id=&q=&sort=    -> file
 *
 * UI-only session: the file is produced in the browser from the same report
 * data. The PDF variant returns a print-ready HTML document that the caller
 * opens and prints (A4 landscape); the backend will render it with WeasyPrint.
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
