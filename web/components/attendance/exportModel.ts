/**
 * One data model for both exports (PDF and Excel), built from a MonthReport
 * plus the report filters. Exports always include everyone in the filter,
 * never just the current page.
 */

import { WEEKDAYS_NE, formatAdRange, formatBs, toNepaliDigits } from "@/lib/bs";
import {
  attendanceRate,
  groupByDepartment,
  matchesQuery,
  openDays,
  presenceSummary,
  sortRows,
  staffPresentPerDay,
  sumTotals,
  type DepartmentGroup,
} from "./helpers";
import type { BsMonthRef, MonthReport, ReportFilters, ReportRow, TodayRef } from "./types";

export interface ExportContext {
  company: string;
  printedBy: string;
  today: TodayRef | null;
  /** Defaults to now; injectable for tests. */
  now?: Date;
}

export interface ExportSummary {
  staff: number;
  avg_present: number;
  rate: number | null;
  /** Total days present (P or O) over the working days. */
  present_days: number;
  overtime_days: number;
  overtime_hours: number;
  absent: number;
  working_days: number;
}

export interface ExportModel {
  company: string;
  title: string;
  month: BsMonthRef;
  ad_range: string;
  filter_label: string;
  printed_by: string;
  printed_at_np: string;
  printed_at_ad: string;
  summary: ExportSummary;
  /** Rows in department order, grouped (always grouped in exports). */
  groups: DepartmentGroup[];
  rows: ReportRow[];
  staff_present: (number | null)[];
  /** True for days nobody has marked yet (shown blank). */
  open_days: boolean[];
  rate_all: number | null;
  /** PDF variant without the Saturday columns (totals still count them). */
  hide_weekly_off: boolean;
}

function printedAd(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")}`;
}

function printedNp(today: TodayRef | null, now: Date): string {
  if (today) return formatBs(today.bs_date, "%A, %B %-d, %Y", "ne");
  return `${WEEKDAYS_NE[now.getDay()]}, ${toNepaliDigits(now.getDate())}`;
}

export function filterReportRows(report: MonthReport, filters: ReportFilters): ReportRow[] {
  return report.rows.filter(
    (row) =>
      (filters.employee_id == null || row.employee.id === filters.employee_id) &&
      (filters.department_id === null || row.employee.department_id === filters.department_id) &&
      matchesQuery(row.employee, filters.query),
  );
}

export function buildExportModel(
  report: MonthReport,
  filters: ReportFilters,
  context: ExportContext,
): ExportModel {
  const now = context.now ?? new Date();
  const order = report.departments.map((d) => d.id);
  const rows = sortRows(filterReportRows(report, filters), filters.sort, true, order);
  const presence = presenceSummary(rows, report.month.days);
  const totals = sumTotals(rows);
  const department = report.departments.find((d) => d.id === filters.department_id);
  const filterParts = [department ? department.name : "All departments"];
  const only = filters.employee_id == null ? null : report.rows.find((r) => r.employee.id === filters.employee_id);
  if (only) filterParts.push(`${only.employee.name} (${only.employee.code})`);
  if (filters.query.trim()) filterParts.push(`search "${filters.query.trim()}"`);
  return {
    company: context.company,
    title: `Attendance report · ${report.month.label}`,
    month: report.month,
    ad_range: formatAdRange(report.month.ad_start, report.month.ad_end),
    filter_label: filterParts.join(" · "),
    printed_by: context.printedBy,
    printed_at_np: printedNp(context.today, now),
    printed_at_ad: printedAd(now),
    summary: {
      staff: rows.length,
      avg_present: presence.avg_present,
      rate: presence.rate,
      present_days: presence.present_days,
      overtime_days: totals.overtime_days,
      overtime_hours: totals.overtime_hours,
      absent: totals.absent,
      working_days: report.month.working_days,
    },
    groups: groupByDepartment(rows),
    rows,
    staff_present: staffPresentPerDay(rows, report.month.days),
    open_days: openDays(rows, report.month.days),
    rate_all: attendanceRate(rows),
    hide_weekly_off: filters.hide_weekly_off === true,
  };
}
