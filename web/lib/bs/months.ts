/** BS months, month keys ("2083-07"), month ranges and the fiscal year. */

import { addDays, weekdayOfAd } from "./ad";
import { bsToAd, daysInMonth, isoBs, parseBs, type BsParts } from "./calendar";
import { monthName, toNepaliDigits, type Lang } from "./format";

export interface BsMonth {
  year: number;
  month: number;
}

export interface MonthDay {
  /** "2083-07-07" */
  bs: string;
  /** Day of the BS month, 1-based. */
  day: number;
  /** "2026-10-24" */
  ad: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2083-07" – the value month selects and URLs use. */
export function monthKey(year: number, month: number): string {
  return `${year}-${pad(month)}`;
}

export function parseMonthKey(key: string): BsMonth | null {
  const m = /^(\d{4})-(\d{1,2})$/.exec(key.trim());
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { year: Number(m[1]), month } : null;
}

/** The month `delta` months after (negative: before) the given one. */
export function shiftMonth(year: number, month: number, delta: number): BsMonth {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 + 1 };
}

/** Negative when a is before b, 0 for the same month. */
export function compareMonths(a: BsMonth, b: BsMonth): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

/** The month a BS date belongs to (null when unparsable). */
export function monthOf(bs: string): BsMonth | null {
  const p = parseBs(bs);
  return p ? { year: p.year, month: p.month } : null;
}

/** First and last AD day (inclusive) of a BS month: bsMonthRange(2083, 7) -> 2026-10-18 … 2026-11-16. */
export function bsMonthRange(year: number, month: number): { start: string; end: string } {
  const start = bsToAd(isoBs(year, month, 1));
  return { start, end: addDays(start, daysInMonth(year, month) - 1) };
}

/** Every day of a BS month with its AD date and weekday. */
export function monthDays(year: number, month: number): MonthDay[] {
  const { start } = bsMonthRange(year, month);
  const length = daysInMonth(year, month);
  const days: MonthDay[] = [];
  for (let i = 0; i < length; i++) {
    const ad = addDays(start, i);
    days.push({ bs: isoBs(year, month, i + 1), day: i + 1, ad, weekday: weekdayOfAd(ad) });
  }
  return days;
}

/** "Kartik 2083" / "कार्तिक २०८३" */
export function monthLabel(year: number, month: number, lang: Lang = "en"): string {
  return `${monthName(month, lang)} ${lang === "ne" ? toNepaliDigits(year) : year}`;
}

export interface FiscalYear {
  startYear: number;
  /** "2083/84" */
  label: string;
  /** Shrawan 1 of the start year, "YYYY-MM-DD". */
  start: string;
  /** Ashadh end of the next year, "YYYY-MM-DD". */
  end: string;
}

/** A Nepali fiscal year runs Shrawan 1 … Ashadh end (2083/84 = 2083-04-01 … 2084-03-32). */
export function fiscalYear(bs: string | BsParts): FiscalYear {
  const p = typeof bs === "string" ? parseBs(bs) : bs;
  if (!p) throw new RangeError(`Not a BS date: ${String(bs)}`);
  const startYear = p.month >= 4 ? p.year : p.year - 1;
  return {
    startYear,
    label: `${startYear}/${pad((startYear + 1) % 100)}`,
    start: isoBs(startYear, 4, 1),
    end: isoBs(startYear + 1, 3, daysInMonth(startYear + 1, 3)),
  };
}
