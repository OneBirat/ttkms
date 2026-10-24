/**
 * Pure attendance helpers: status metadata, the paid-days rule, totals, week
 * slicing, staff-present counts, sorting/grouping, staff-card codes. No React,
 * no fetch, so they are unit-tested with node:test (see __tests__/).
 */

import { WEEKDAYS_NE, WEEKDAY_INITIALS_NE, monthName as bsMonthName, weekdayInitial } from "@/lib/bs";
import type {
  AttendanceTotals,
  CellStatus,
  DayCell,
  DayHeader,
  EmployeeRef,
  MarkStatus,
  ReportRow,
  ReportSort,
  WeekGrid,
} from "./types";
import { OT_MAX, OT_MIN } from "./types";

export { weekdayInitial };

/** "आ आइत · सो सोम · …" for the weekday legend. */
export function weekdayKeyText(): string {
  return WEEKDAY_INITIALS_NE.map((initial, i) => `${initial} ${WEEKDAYS_NE[i].replace(/बार$/, "")}`).join(" · ");
}

// ------------------------------------------------------------ statuses

export interface StatusMeta {
  /** "Present", "Overtime", "Absent", "Weekly off", "Not marked" */
  label: string;
  /** Nepali label for the mobile buttons / sheets. */
  label_np: string;
  /** Grid letter: P, O, A, – or "" (not marked). */
  code: string;
  /** Key shown before the mobile button label. */
  key: string;
}

export const STATUS_META: Record<CellStatus, StatusMeta> = {
  P: { label: "Present", label_np: "हाजिर", code: "P", key: "✓" },
  O: { label: "Overtime", label_np: "ओभरटाइम", code: "O", key: "+" },
  A: { label: "Absent", label_np: "अनुपस्थित", code: "A", key: "✕" },
  W: { label: "Weekly off", label_np: "साप्ताहिक बिदा", code: "–", key: "" },
  N: { label: "Not marked", label_np: "हाजिरी छैन", code: "", key: "" },
};

export function statusLabel(status: CellStatus): string {
  return STATUS_META[status].label;
}

/** Report cell text: "P", "O2", "A", "–", "". */
export function cellCode(cell: DayCell): string {
  if (cell.status === "O") return `O${cell.ot_hours || ""}`;
  return STATUS_META[cell.status].code;
}

/** Long text for a cell: "Overtime 2 h", "Present", "Weekly off"… */
export function cellText(cell: DayCell): string {
  if (cell.status === "O") return `Overtime ${cell.ot_hours} h`;
  return STATUS_META[cell.status].label;
}

/** Statuses that count as "in" (present or present + overtime). */
export function isPresentish(status: CellStatus): boolean {
  return status === "P" || status === "O";
}

/** Whole hours, clamped to 1–12. */
export function clampHours(value: number): number {
  const n = Math.round(Number.isFinite(value) ? value : OT_MIN);
  return Math.min(OT_MAX, Math.max(OT_MIN, n));
}

// ------------------------------------------------------------ totals

export interface PaidDaysInput {
  present: number;
  overtime_days: number;
  weekly_off: number;
}

/** Paid days = present + overtime days + weekly off. Absent is unpaid. */
export function paidDays(t: PaidDaysInput): number {
  return t.present + t.overtime_days + t.weekly_off;
}

export function emptyTotals(): AttendanceTotals {
  return {
    present: 0,
    overtime_days: 0,
    overtime_hours: 0,
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
  for (const cell of cells) {
    switch (cell.status) {
      case "P":
        t.present += 1;
        break;
      case "O":
        t.overtime_days += 1;
        t.overtime_hours += cell.ot_hours;
        break;
      case "A":
        t.absent += 1;
        break;
      case "W":
        t.weekly_off += 1;
        break;
      default:
        t.not_marked += 1;
    }
  }
  t.marked_days = t.present + t.overtime_days + t.absent;
  t.attended = t.present + t.overtime_days;
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
 * Attendance rate of a set of rows: days attended over marked working days
 * (present + overtime + absent). Null when nothing is marked yet.
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

/** Staff present (P or O) per day; null on weekly-off days. */
export function staffPresentPerDay(
  rows: readonly ReportRow[],
  days: readonly DayHeader[],
): (number | null)[] {
  return days.map((day, i) => {
    if (day.is_weekly_off) return null;
    let count = 0;
    for (const row of rows) {
      if (isPresentish(row.cells[i]?.status ?? "N")) count += 1;
    }
    return count;
  });
}

/**
 * Days (not weekly off) on which nobody has a mark yet - typically days still
 * ahead in the current month. They are left out of averages and shown blank.
 */
export function openDays(rows: readonly ReportRow[], days: readonly DayHeader[]): boolean[] {
  return days.map(
    (day, i) =>
      !day.is_weekly_off &&
      rows.length > 0 &&
      rows.every((row) => (row.cells[i]?.status ?? "N") === "N"),
  );
}

export interface PresenceSummary {
  /** Working days in the range (not weekly off, at least one mark). */
  working_days: number;
  /** Sum of staff-present counts over those days. */
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
  const open = openDays(rows, days);
  let working = 0;
  let present = 0;
  perDay.forEach((n, i) => {
    if (n === null || open[i]) return;
    working += 1;
    present += n;
  });
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
    weeks.push({ index, label: weekLabel(monthName, current, index), days: current, offset });
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

/** "Kartik 1–7 (week 1)" */
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

/** "Kartik 4" from a day header and the month name. */
export function bsDayLabel(monthName: string, day: DayHeader): string {
  return `${monthName} ${day.bs_day}`;
}

/** Month name of a "YYYY-MM-DD" BS date. */
export function monthNameOf(bs: string): string {
  const month = Number(bs.slice(5, 7));
  return month >= 1 && month <= 12 ? bsMonthName(month) : "";
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
  overtime: (a, b) => b.totals.overtime_hours - a.totals.overtime_hours || byName(a, b),
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

// ------------------------------------------------------------ marking

/** One employee's unsaved mark on the Mark screen. */
export interface Draft {
  status: MarkStatus | null;
  /** 1–12 when status is "O", else 0. */
  ot_hours: number;
  note: string;
}

export const EMPTY_DRAFT: Draft = { status: null, ot_hours: 0, note: "" };

export function sameDraft(a: Draft, b: Draft): boolean {
  return a.status === b.status && a.ot_hours === b.ot_hours && a.note === b.note;
}

/** Counts shown in the summary chips / mobile tiles for a scope of drafts. */
export interface MarkCounts {
  total: number;
  /** P only. */
  present: number;
  /** O only. */
  overtime: number;
  absent: number;
  not_marked: number;
  /** Sum of overtime hours. */
  overtime_hours: number;
}

export function countMarks(drafts: readonly Draft[]): MarkCounts {
  const c: MarkCounts = { total: drafts.length, present: 0, overtime: 0, absent: 0, not_marked: 0, overtime_hours: 0 };
  for (const d of drafts) {
    if (d.status === "P") c.present += 1;
    else if (d.status === "O") {
      c.overtime += 1;
      c.overtime_hours += d.ot_hours;
    } else if (d.status === "A") c.absent += 1;
    else c.not_marked += 1;
  }
  return c;
}

/** Status filter of the Mark screens: "" = all, else one status, "N" = not marked. */
export type StatusFilter = "" | CellStatus;

/** Does a day status pass the filter? The Present pill counts overtime days too. */
export function matchesStatusFilter(status: CellStatus, filter: StatusFilter): boolean {
  if (!filter) return true;
  if (filter === "P") return status === "P" || status === "O";
  return status === filter;
}

/** Status of a mark row as the screens show it ("N" without a record). */
export function recordStatus(record: { status: MarkStatus } | null | undefined): CellStatus {
  return record?.status ?? "N";
}

/** Short text of a draft: "Present", "Overtime · 2 h", "Absent", "Not marked". */
export function draftText(d: Draft): string {
  if (d.status === "O") return `Overtime · ${d.ot_hours} h`;
  return d.status ? STATUS_META[d.status].label : STATUS_META.N.label;
}

// ------------------------------------------------------------ staff cards

/**
 * Normalises whatever a scanner or a person typed to an employee code:
 * "TTK-E004", "ttk-e004", "E-004", "E004", "e4", "4" -> "E-004".
 * Returns null for anything that is not a code shape ("TTK-X917").
 */
export function normalizeCode(raw: string): string | null {
  let c = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!c) return null;
  c = c.replace(/^TTK-?/, "").replace(/^E-?/, "");
  if (!/^\d{1,6}$/.test(c)) return null;
  return `E-${c.padStart(3, "0")}`;
}

export function findByCode<T extends { code: string }>(employees: readonly T[], raw: string): T | null {
  const code = normalizeCode(raw);
  if (!code) return null;
  return employees.find((e) => e.code === code) ?? null;
}

/** "Kamala Bhandari" -> "KB"; "Sunita B.K." -> "SB". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// ------------------------------------------------------------ money

const rsFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** 2000 -> "2,000" (Nepali/Indian grouping). */
export function formatAmount(amount: number): string {
  return rsFormat.format(amount);
}

/** 2000 -> "Rs 2,000" */
export function formatRs(amount: number): string {
  return `Rs ${formatAmount(amount)}`;
}

/** Validates a payment amount against the balance due. Null = fine. */
export function paymentError(amount: number, due: number, monthLabel: string): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return "Enter an amount above 0.";
  if (amount > due) return `More than the balance due for ${monthLabel} (${formatRs(due)}).`;
  return null;
}
