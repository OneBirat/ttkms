/**
 * Pure attendance helpers: status metadata, paid-days rule, totals, week
 * slicing, staff-present counts, sorting/grouping. No React, no fetch, so
 * they are unit-tested with node:test (see __tests__/).
 */

import type {
  AttendanceStatus,
  AttendanceTotals,
  DayCell,
  DayHeader,
  DayStatus,
  EmployeeRef,
  ReportRow,
  ReportSort,
  WeekGrid,
} from "./types";

// ------------------------------------------------------------ weekdays

/** Single Nepali initials, Sunday … Saturday (आ सो मं बु बि शु श). */
export const WEEKDAY_INITIALS_NP = ["आ", "सो", "मं", "बु", "बि", "शु", "श"] as const;

export const WEEKDAY_NAMES_NP = [
  "आइतबार",
  "सोमबार",
  "मंगलबार",
  "बुधबार",
  "बिहीबार",
  "शुक्रबार",
  "शनिबार",
] as const;

export const WEEKDAY_NAMES_EN = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** weekdayInitial(6) -> "श"; out-of-range values wrap like JS Date#getDay. */
export function weekdayInitial(weekday: number): string {
  return WEEKDAY_INITIALS_NP[((weekday % 7) + 7) % 7];
}

/** "आ आइत · सो सोम · …" for the legend. */
export function weekdayKeyText(): string {
  return WEEKDAY_INITIALS_NP.map(
    (initial, i) => `${initial} ${WEEKDAY_NAMES_NP[i].replace(/बार$/, "")}`,
  ).join(" · ");
}

// ------------------------------------------------------------ statuses

export interface StatusMeta {
  /** Full label, "Half day". */
  label: string;
  /** Short label for narrow buttons, "Half". */
  short: string;
  /** Grid letter. */
  code: string;
}

export const STATUS_META: Record<DayStatus, StatusMeta> = {
  present: { label: "Present", short: "Present", code: "P" },
  late: { label: "Late", short: "Late", code: "L" },
  half_day: { label: "Half day", short: "Half", code: "H" },
  leave: { label: "Leave", short: "Leave", code: "V" },
  absent: { label: "Absent", short: "Absent", code: "A" },
  weekly_off: { label: "Weekly off", short: "Off", code: "–" },
  not_marked: { label: "Not marked", short: "Not marked", code: "" },
};

export function statusCode(status: DayStatus): string {
  return STATUS_META[status].code;
}

export function statusLabel(status: DayStatus): string {
  return STATUS_META[status].label;
}

/** Statuses that count as "in" for the staff-present row. */
export function isPresentish(status: DayStatus): boolean {
  return status === "present" || status === "late" || status === "half_day";
}

// ------------------------------------------------------------ totals

export interface PaidDaysInput {
  present: number;
  late: number;
  leave: number;
  weekly_off: number;
  half_day: number;
}

/** Paid days = present + late + leave + weekly off + ½ per half day. Absent is unpaid. */
export function paidDays(t: PaidDaysInput): number {
  return t.present + t.late + t.leave + t.weekly_off + t.half_day / 2;
}

export function emptyTotals(): AttendanceTotals {
  return {
    present: 0,
    late: 0,
    half_day: 0,
    leave: 0,
    absent: 0,
    weekly_off: 0,
    not_marked: 0,
    marked_days: 0,
    attended: 0,
    paid_days: 0,
  };
}

export function computeTotals(cells: readonly DayCell[]): AttendanceTotals {
  const t = emptyTotals();
  for (const cell of cells) t[cell.status] += 1;
  t.marked_days = t.present + t.late + t.half_day + t.leave + t.absent;
  t.attended = t.present + t.late + t.half_day / 2;
  t.paid_days = paidDays(t);
  return t;
}

export function sumTotals(rows: readonly ReportRow[]): AttendanceTotals {
  const sum = emptyTotals();
  for (const row of rows) {
    for (const key of Object.keys(sum) as (keyof AttendanceTotals)[]) {
      sum[key] += row.totals[key];
    }
  }
  return sum;
}

/**
 * Attendance rate of a set of rows: attended days over marked working days
 * (present + late + half + leave + absent). Null when nothing is marked yet.
 */
export function attendanceRate(rows: readonly ReportRow[]): number | null {
  let attended = 0;
  let marked = 0;
  for (const row of rows) {
    attended += row.totals.attended;
    marked += row.totals.marked_days;
  }
  return marked ? attended / marked : null;
}

export function formatRate(rate: number | null): string {
  return rate === null ? "–" : `${Math.round(rate * 100)}%`;
}

// ------------------------------------------------------------ days

/**
 * Staff present (present, late or half day) per day; null on weekly-off days.
 */
export function staffPresentPerDay(
  rows: readonly ReportRow[],
  days: readonly DayHeader[],
): (number | null)[] {
  return days.map((day, i) => {
    if (day.is_weekly_off) return null;
    let count = 0;
    for (const row of rows) {
      if (isPresentish(row.cells[i]?.status ?? "not_marked")) count += 1;
    }
    return count;
  });
}

export interface PresenceSummary {
  /** Working days in the range (not weekly off). */
  working_days: number;
  /** Sum of staff-present counts over working days. */
  present_days: number;
  /** present_days / working_days. */
  avg_present: number;
  /** avg_present / staff; null without staff. */
  rate: number | null;
}

export function presenceSummary(
  rows: readonly ReportRow[],
  days: readonly DayHeader[],
): PresenceSummary {
  const perDay = staffPresentPerDay(rows, days);
  let working = 0;
  let present = 0;
  for (const n of perDay) {
    if (n === null) continue;
    working += 1;
    present += n;
  }
  const avg = working ? present / working : 0;
  return {
    working_days: working,
    present_days: present,
    avg_present: avg,
    rate: rows.length ? avg / rows.length : null,
  };
}

/** Days under this share of staff are shown in red in the staff-present row. */
export const LOW_PRESENCE_RATIO = 0.8;

export function isLowPresence(count: number, staff: number): boolean {
  return staff > 0 && count < staff * LOW_PRESENCE_RATIO;
}

/**
 * Splits a month's days into Sunday…Saturday weeks. The first and last week
 * may be short. Each week knows its offset into `days`.
 */
export function sliceWeeks(days: readonly DayHeader[], monthName: string): WeekGrid[] {
  const weeks: WeekGrid[] = [];
  let current: DayHeader[] = [];
  let offset = 0;
  const flush = () => {
    if (!current.length) return;
    const index = weeks.length + 1;
    weeks.push({
      index,
      label: weekLabel(monthName, current, index),
      days: current,
      offset,
    });
    offset += current.length;
    current = [];
  };
  for (const day of days) {
    if (day.weekday === 0 && current.length) flush();
    current.push(day);
  }
  flush();
  return weeks;
}

/** "Ashoj 1–3 (week 1)" */
export function weekLabel(monthName: string, days: readonly DayHeader[], index: number): string {
  const first = days[0]?.bs_day ?? 0;
  const last = days[days.length - 1]?.bs_day ?? first;
  const range = first === last ? `${first}` : `${first}–${last}`;
  return `${monthName} ${range} (week ${index})`;
}

/** Index of the week that contains `bsDay` (1-based week index), else 1. */
export function weekIndexOfDay(weeks: readonly WeekGrid[], bsDay: number): number {
  const week = weeks.find((w) => w.days.some((d) => d.bs_day === bsDay));
  return week?.index ?? 1;
}

/** Slice every row's cells to one week. */
export function sliceRows(rows: readonly ReportRow[], week: WeekGrid): ReportRow[] {
  return rows.map((row) => {
    const cells = row.cells.slice(week.offset, week.offset + week.days.length);
    return { employee: row.employee, cells, totals: computeTotals(cells) };
  });
}

// ------------------------------------------------------------ dates

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-17" -> "17 Sep" (or "17 Sep 2026" with `withYear`). */
export function formatAdShort(iso: string, withYear = false): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS_SHORT[m - 1]}${withYear ? ` ${y}` : ""}`;
}

/** "17 Sep – 16 Oct 2026" (year shown once when it does not change). */
export function formatAdRange(start: string, end: string): string {
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${formatAdShort(start, !sameYear)} – ${formatAdShort(end, true)}`;
}

/** "Ashoj 4" from a day header and the month name. */
export function bsDayLabel(monthName: string, day: DayHeader): string {
  return `${monthName} ${day.bs_day}`;
}

/** Loose "HH:MM" check (24h). */
export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Minutes since midnight for "HH:MM"; null when invalid. */
export function timeToMinutes(value: string | null): number | null {
  if (!value || !isValidTime(value)) return null;
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** True when an in time is after the late threshold (both "HH:MM"). */
export function isLateArrival(inTime: string | null, lateAfter: string): boolean {
  const a = timeToMinutes(inTime);
  const b = timeToMinutes(lateAfter);
  return a !== null && b !== null && a > b;
}

// ------------------------------------------------------------ lists

/** Name or employee code contains the query (case-insensitive). */
export function matchesQuery(employee: EmployeeRef, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return employee.name.toLowerCase().includes(q) || employee.code.toLowerCase().includes(q);
}

const byName = (a: ReportRow, b: ReportRow) => a.employee.name.localeCompare(b.employee.name);

const SORTERS: Record<ReportSort, (a: ReportRow, b: ReportRow) => number> = {
  dept: byName,
  name: byName,
  absent: (a, b) => b.totals.absent - a.totals.absent || byName(a, b),
  late: (a, b) => b.totals.late - a.totals.late || byName(a, b),
};

/**
 * Sorts report rows. With `group` (or the "dept" sort) rows are ordered by
 * department first, in `departmentOrder` order, then by the chosen key.
 */
export function sortRows(
  rows: readonly ReportRow[],
  sort: ReportSort,
  group: boolean,
  departmentOrder: readonly number[],
): ReportRow[] {
  const key = SORTERS[sort];
  const useGroup = group || sort === "dept";
  const rank = (id: number) => {
    const i = departmentOrder.indexOf(id);
    return i === -1 ? departmentOrder.length : i;
  };
  return [...rows].sort((a, b) => {
    if (useGroup && a.employee.department_id !== b.employee.department_id) {
      return rank(a.employee.department_id) - rank(b.employee.department_id);
    }
    return key(a, b);
  });
}

export interface DepartmentGroup {
  department_id: number;
  department_name: string;
  rows: ReportRow[];
  rate: number | null;
}

/** Consecutive runs of the same department (call after sortRows with group). */
export function groupByDepartment(rows: readonly ReportRow[]): DepartmentGroup[] {
  const groups: DepartmentGroup[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.department_id === row.employee.department_id) {
      last.rows.push(row);
    } else {
      groups.push({
        department_id: row.employee.department_id,
        department_name: row.employee.department_name,
        rows: [row],
        rate: null,
      });
    }
  }
  for (const g of groups) g.rate = attendanceRate(g.rows);
  return groups;
}

export interface Page<T> {
  items: T[];
  page: number;
  pages: number;
  total: number;
  perPage: number;
}

export function paginate<T>(items: readonly T[], page: number, perPage: number): Page<T> {
  const size = Math.max(1, perPage);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, page), pages);
  return {
    items: items.slice((current - 1) * size, current * size),
    page: current,
    pages,
    total: items.length,
    perPage: size,
  };
}

/** Counts of each status for a set of mark rows (not_marked for missing records). */
export type StatusCounts = Record<AttendanceStatus | "not_marked", number>;

export function emptyCounts(): StatusCounts {
  return { present: 0, late: 0, half_day: 0, leave: 0, absent: 0, not_marked: 0 };
}
