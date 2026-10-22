/**
 * One data model for both exports (PDF and Excel), built from a MonthReport
 * plus the report filters. Exports always include everyone in the filter,
 * never just the current page.
 */

import { toDevanagariDigits } from "@/lib/bsdate";
import {
  WEEKDAY_NAMES_NP,
  attendanceRate,
  formatAdRange,
  groupByDepartment,
  matchesQuery,
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
  present_days: number;
  late: number;
  absent: number;
  leave: number;
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
  rate_all: number | null;
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
  if (today) return today.np_text;
  return `${WEEKDAY_NAMES_NP[now.getDay()]}, ${toDevanagariDigits(now.getDate())}`;
}

export function filterReportRows(report: MonthReport, filters: ReportFilters): ReportRow[] {
  return report.rows.filter(
    (row) =>
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
      late: totals.late,
      absent: totals.absent,
      leave: totals.leave,
      working_days: report.month.working_days,
    },
    groups: groupByDepartment(rows),
    rows,
    staff_present: staffPresentPerDay(rows, report.month.days),
    rate_all: attendanceRate(rows),
  };
}
