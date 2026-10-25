/**
 * Pure rules of the employee account (/people/employees/[id]), tested in
 * __tests__/account.test.mjs: the side list (this employee's branch, own department first), its
 * collapsed state in localStorage, the Attendance calendar card (Sun-Sat grid, chips, month
 * limits) and the "Last 6 payments" card.
 */

import { addMonths, compareMonths, parseMonthKey } from "./months";
import { groupByDepartment, type DepartmentGroup } from "./helpers";
import type { BsMonth, Department, Employee, EmployeeSort, MonthLedger, Payment } from "../types";

// --------------------------------------------------------------------- tabs

export type AccountTab = "overview" | "salary" | "ledger" | "documents";

export const ACCOUNT_TABS: { value: AccountTab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "salary", label: "Salary" },
  { value: "ledger", label: "Ledger" },
  { value: "documents", label: "Documents" },
];

export function isAccountTab(value: string | null): value is AccountTab {
  return ACCOUNT_TABS.some((t) => t.value === value);
}

// ---------------------------------------------------------------- side list

/** Only the staff of this employee's branch. */
export function branchStaff(employees: readonly Employee[], branchId: number): Employee[] {
  return employees.filter((e) => e.branch.id === branchId);
}

/** Department groups with the employee's own department first, the others in their usual order. */
export function staffGroups(
  employees: Employee[],
  departments: Department[],
  sort: EmployeeSort,
  ownDepartmentId: number | null,
): DepartmentGroup[] {
  const all = groupByDepartment(employees, departments, sort);
  if (ownDepartmentId === null) return all;
  return [...all.filter((g) => g.department?.id === ownDepartmentId), ...all.filter((g) => g.department?.id !== ownDepartmentId)];
}

export const LIST_COLLAPSED_KEY = "ttk.people.staffList.collapsed";

/** The remembered collapsed / open state; false when storage is unavailable. */
export function readCollapsed(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): boolean {
  try {
    return storage?.getItem(LIST_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeCollapsed(collapsed: boolean, storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(LIST_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // private mode / storage full: the state just isn't remembered
  }
}

// ---------------------------------------------------------- attendance card

/** What a calendar day shows: P / O / A / W (Saturday off), or nothing (future, before joining, not marked). */
export type CalendarMark = "P" | "O" | "A" | "W" | null;

export interface CalendarDayIn {
  bs_date: string;
  bs_day: number;
  ad_date: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** P / O / A / W / N from the attendance employee-month endpoint. */
  status: string;
  ot_hours: number;
}

export interface CalendarDay {
  bs_date: string;
  bs_day: number;
  ad_date: string;
  /** "Oct 18" on the first day shown and on the 1st of an AD month, else the AD day ("19"). */
  ad_label: string;
  mark: CalendarMark;
  ot_hours: number;
  saturday: boolean;
  today: boolean;
}

const AD_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The month as Sun-Sat weeks (null = padding before the 1st / after the last day). Future days and
 * days before the joining date are blank whatever the server sent (a future Saturday is "W" there).
 */
export function calendarWeeks(days: readonly CalendarDayIn[], todayBs: string, joinedBs: string): (CalendarDay | null)[][] {
  const out: (CalendarDay | null)[] = [];
  if (days.length === 0) return [];
  for (let i = 0; i < days[0].weekday; i++) out.push(null);
  days.forEach((d, index) => {
    const blank = d.bs_date > todayBs || d.bs_date < joinedBs;
    const mark: CalendarMark = blank || !["P", "O", "A", "W"].includes(d.status) ? null : (d.status as CalendarMark);
    const [, m, day] = d.ad_date.split("-").map(Number);
    out.push({
      bs_date: d.bs_date,
      bs_day: d.bs_day,
      ad_date: d.ad_date,
      ad_label: index === 0 || day === 1 ? `${AD_MONTHS[m - 1]} ${day}` : String(day),
      mark,
      ot_hours: mark === "O" ? d.ot_hours : 0,
      saturday: d.weekday === 6,
      today: d.bs_date === todayBs,
    });
  });
  while (out.length % 7 !== 0) out.push(null);
  const weeks: (CalendarDay | null)[][] = [];
  for (let i = 0; i < out.length; i += 7) weeks.push(out.slice(i, i + 7));
  return weeks;
}

export interface CalendarChips {
  present: number;
  overtime: number;
  hours: number;
  absent: number;
  saturday: number;
}

/** "Present N · Overtime N · H h · Absent N · Saturday N" over the days the grid shows a mark for. */
export function calendarChips(weeks: readonly (CalendarDay | null)[][]): CalendarChips {
  const chips: CalendarChips = { present: 0, overtime: 0, hours: 0, absent: 0, saturday: 0 };
  for (const day of weeks.flat()) {
    if (!day?.mark) continue;
    if (day.mark === "P") chips.present += 1;
    else if (day.mark === "O") {
      chips.overtime += 1;
      chips.hours += day.ot_hours;
    } else if (day.mark === "A") chips.absent += 1;
    else chips.saturday += 1;
  }
  return chips;
}

/** ‹ › limits: back to the joining month, never past the running month. */
export function calendarBounds(joinedBs: string, current: BsMonth): { min: BsMonth; max: BsMonth } {
  const joined = parseMonthKey(joinedBs.slice(0, 7)) ?? current;
  return { min: compareMonths(joined, current) > 0 ? current : joined, max: current };
}

/** The month after one ‹ / › click, kept inside the bounds. */
export function stepMonth(month: BsMonth, delta: number, bounds: { min: BsMonth; max: BsMonth }): BsMonth {
  const next = addMonths(month, delta);
  if (compareMonths(next, bounds.min) < 0) return bounds.min;
  if (compareMonths(next, bounds.max) > 0) return bounds.max;
  return next;
}

/** /attendance/report?employee=&bs_year=&bs_month= ("View all ›"). */
export function attendanceReportHref(employeeId: number, month: BsMonth): string {
  return `/attendance/report?employee=${employeeId}&bs_year=${month.bs_year}&bs_month=${month.bs_month}`;
}

// --------------------------------------------------------- last 6 payments

/** The most recent non-voided payments over every month of the ledger, newest first. */
export function lastPayments(ledger: readonly MonthLedger[], count = 6): Payment[] {
  return ledger
    .flatMap((l) => l.payments)
    .filter((p) => !p.voided)
    .sort((a, b) => b.date.bs.localeCompare(a.date.bs) || b.id - a.id)
    .slice(0, count);
}
