/**
 * Adapters between the payroll API shapes (BsMonth = { bs_year, bs_month }, DateBoth =
 * { bs, ad }, DateRange = { from_bs, to_bs }) and the shared calendar in web/lib/bs. No calendar
 * knowledge lives here: every function forwards to @/lib/bs with the arguments unpacked.
 */

import {
  adToBsIso,
  bsMonthRange,
  bsToAd,
  compareMonths as compareYearMonth,
  daysInMonth as daysInYearMonth,
  formatMonthRange as formatYearMonthRange,
  isoBs,
  monthKey as yearMonthKey,
  monthLabel as yearMonthLabel,
  monthName as bsMonthName,
  nowInKathmandu,
  parseMonthKey as parseYearMonthKey,
  presetOf as presetOfRange,
  rangeFor as rangeForPreset,
  shiftMonth,
  todayAd,
  validBs,
  type Lang,
} from "@/lib/bs";
import type { BsMonth, DateBoth, DateRange, RangePreset } from "../types";

export { RANGE_PRESETS } from "@/lib/bs";

/** "2083-07" */
export function monthKey(month: BsMonth): string {
  return yearMonthKey(month.bs_year, month.bs_month);
}

export function parseMonthKey(key: string): BsMonth | null {
  const m = parseYearMonthKey(key);
  return m ? { bs_year: m.year, bs_month: m.month } : null;
}

/** "Kartik 2083" / "कार्तिक २०८३" */
export function monthLabel(month: BsMonth, lang: Lang = "en"): string {
  return yearMonthLabel(month.bs_year, month.bs_month, lang);
}

/** "Kartik" / "कार्तिक" */
export function monthName(month: BsMonth, lang: Lang = "en"): string {
  return bsMonthName(month.bs_month, lang);
}

export function sameMonth(a: BsMonth, b: BsMonth): boolean {
  return a.bs_year === b.bs_year && a.bs_month === b.bs_month;
}

export function addMonths(month: BsMonth, delta: number): BsMonth {
  const m = shiftMonth(month.bs_year, month.bs_month, delta);
  return { bs_year: m.year, bs_month: m.month };
}

/** Negative when a is before b. */
export function compareMonths(a: BsMonth, b: BsMonth): number {
  return compareYearMonth({ year: a.bs_year, month: a.bs_month }, { year: b.bs_year, month: b.bs_month });
}

export function daysInMonth(month: BsMonth): number {
  return daysInYearMonth(month.bs_year, month.bs_month);
}

export function monthStart(month: BsMonth): DateBoth {
  return { bs: isoBs(month.bs_year, month.bs_month, 1), ad: bsMonthRange(month.bs_year, month.bs_month).start };
}

export function monthEnd(month: BsMonth): DateBoth {
  return { bs: isoBs(month.bs_year, month.bs_month, daysInMonth(month)), ad: bsMonthRange(month.bs_year, month.bs_month).end };
}

/** "Kartik 1 – 30, 2083 · 18 Oct – 16 Nov 2026" */
export function formatMonthRange(month: BsMonth, lang: Lang = "en"): string {
  return formatYearMonthRange(month.bs_year, month.bs_month, lang);
}

/** Both calendars for a BS date string; throws when the date does not exist. */
export function dateBoth(bs: string): DateBoth {
  const parts = validBs(bs);
  if (!parts) throw new RangeError(`Not a BS date: ${bs}`);
  return { bs: isoBs(parts), ad: bsToAd(parts) };
}

/** Today in Kathmandu, both calendars. */
export function today(now: Date = new Date()): DateBoth {
  const ad = todayAd(now);
  return { bs: adToBsIso(ad), ad };
}

/** The BS month running today in Kathmandu. */
export function thisMonth(now: Date = new Date()): BsMonth {
  const { year, month } = nowInKathmandu(now).bsParts;
  return { bs_year: year, bs_month: month };
}

export function rangeFor(preset: RangePreset, now: Date = new Date()): DateRange {
  const r = rangeForPreset(preset, now);
  return { from_bs: r.from, to_bs: r.to };
}

export function presetOf(range: DateRange, now: Date = new Date()): RangePreset | null {
  return presetOfRange({ from: range.from_bs, to: range.to_bs }, now);
}
