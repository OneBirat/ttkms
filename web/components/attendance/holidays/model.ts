/**
 * Pure rules of the Holiday calendar (tested in __tests__/holidays.test.ts): the month grid
 * (Sunday - Saturday, one BS month, trailing days of the next month muted), the count chips,
 * the next holiday of the dashboard strip. "Today" always comes from the server (Kathmandu).
 */

import { addDays, bsToAd, daysInMonth, diffDays, formatAd, isoBs, monthDays, monthName, shiftMonth, weekdayName } from "@/lib/bs";
import type { Holiday } from "../types";

export const HOLIDAY_NAME_MAX = 120;
export const WEEKLY_OFF = 6;

export interface HolidayCell {
  /** "2083-07-22" */
  bs: string;
  bsDay: number;
  /** "2026-11-08" */
  ad: string;
  /** "8 Nov" */
  adLabel: string;
  weekday: number;
  weeklyOff: boolean;
  isToday: boolean;
  /** Before today: greyed and disabled (a past holiday keeps its chip). */
  past: boolean;
  /** A day of the next BS month filling the last week: shown muted, not clickable. */
  trailing: boolean;
  holiday: Holiday | null;
}

/** Holidays by AD date (one per day on the calendar: the first by id when branches differ). */
export function holidaysByDate(holidays: readonly Holiday[]): Map<string, Holiday> {
  const map = new Map<string, Holiday>();
  for (const h of [...holidays].sort((a, b) => a.id - b.id)) if (!map.has(h.date)) map.set(h.date, h);
  return map;
}

/**
 * The grid of one BS month: leading blanks (null) up to the weekday of day 1, every day of the
 * month, then days of the next month (trailing) to finish the last week.
 */
export function calendarCells(year: number, month: number, holidays: readonly Holiday[], todayAd: string): (HolidayCell | null)[] {
  const byDate = holidaysByDate(holidays);
  const cell = (bs: string, bsDay: number, ad: string, weekday: number, trailing: boolean): HolidayCell => ({
    bs,
    bsDay,
    ad,
    adLabel: formatAd(ad, "%-d %b"),
    weekday,
    weeklyOff: weekday === WEEKLY_OFF,
    isToday: ad === todayAd,
    past: ad < todayAd,
    trailing,
    holiday: trailing ? null : (byDate.get(ad) ?? null),
  });
  const days = monthDays(year, month);
  const cells: (HolidayCell | null)[] = Array.from({ length: days[0].weekday }, () => null);
  for (const d of days) cells.push(cell(d.bs, d.day, d.ad, d.weekday, false));
  const next = shiftMonth(year, month, 1);
  let ad = addDays(days[days.length - 1].ad, 1);
  for (let day = 1; cells.length % 7 !== 0; day++) {
    cells.push(cell(isoBs(next.year, next.month, day), day, ad, cells.length % 7, true));
    ad = addDays(ad, 1);
  }
  return cells;
}

export interface MonthCounts {
  holidays: number;
  weeklyOff: number;
  working: number;
}

/** Chips: public holidays (not on a Saturday), weekly off days, and the rest. */
export function monthCounts(year: number, month: number, holidays: readonly Holiday[]): MonthCounts {
  const byDate = holidaysByDate(holidays);
  const days = monthDays(year, month);
  const weeklyOff = days.filter((d) => d.weekday === WEEKLY_OFF).length;
  const onWorkingDays = days.filter((d) => d.weekday !== WEEKLY_OFF && byDate.has(d.ad)).length;
  return { holidays: onWorkingDays, weeklyOff, working: daysInMonth(year, month) - weeklyOff - onWorkingDays };
}

/** "All branches" or the branch names. */
export function scopeText(h: Pick<Holiday, "all_branches" | "branch_names">): string {
  return h.all_branches ? "All branches" : h.branch_names.join(", ") || "Selected branches";
}

/** "Sunday · 8 Nov 2026" */
export function weekdayAndAd(ad: string): string {
  return `${weekdayName(new Date(`${ad}T00:00:00Z`).getUTCDay())} · ${formatAd(ad)}`;
}

/** The first holiday today or later (the list is date-ordered by the server). */
export function nextHoliday(holidays: readonly Holiday[], todayAd: string): Holiday | null {
  return [...holidays].filter((h) => h.date >= todayAd).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)[0] ?? null;
}

/** "today" / "tomorrow" / "in 5 days" */
export function inDaysText(ad: string, todayAd: string): string {
  const n = diffDays(todayAd, ad);
  return n <= 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`;
}

/** The BS tile of the strip: day and short month ("22", "Kartik"). */
export function bsTile(bs: string): { day: string; month: string } {
  const [, m, d] = bs.split("-").map(Number);
  return { day: String(d), month: monthName(m) };
}

export interface HolidayForm {
  id: number | null;
  /** BS "YYYY-MM-DD" ("" until picked). */
  date_bs: string;
  name: string;
  all_branches: boolean;
  branch_ids: number[];
  is_paid: boolean;
}

export const EMPTY_FORM: HolidayForm = { id: null, date_bs: "", name: "", all_branches: true, branch_ids: [], is_paid: true };

export function formOf(h: Holiday): HolidayForm {
  return { id: h.id, date_bs: h.date_bs, name: h.name, all_branches: h.all_branches, branch_ids: [...h.branch_ids], is_paid: h.is_paid };
}

/** What the form checks before asking the server (the server checks again). field -> message. */
export function formErrors(form: HolidayForm, todayAd: string): Partial<Record<"date" | "name" | "branch_ids", string>> {
  const errors: Partial<Record<"date" | "name" | "branch_ids", string>> = {};
  if (!form.date_bs) errors.date = "Pick a date.";
  else if (bsToAd(form.date_bs) < todayAd) errors.date = "That day has passed. Pick today or a later day.";
  if (!form.name.trim()) errors.name = "Give the holiday a name.";
  if (!form.all_branches && form.branch_ids.length === 0) errors.branch_ids = "Choose at least one branch.";
  return errors;
}

/** The request body of POST / PATCH (AD date). */
export function bodyOf(form: HolidayForm) {
  return {
    date: bsToAd(form.date_bs),
    name: form.name.trim(),
    all_branches: form.all_branches,
    branch_ids: form.all_branches ? [] : form.branch_ids,
    is_paid: form.is_paid,
  };
}
