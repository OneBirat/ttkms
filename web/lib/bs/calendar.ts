/**
 * The Bikram Sambat table and the AD <-> BS conversions.
 *
 * Month lengths come from calendar-data.json (generated from the nepali-datetime package by
 * scripts/gen_bs_calendar.py) with calendar-overrides.json applied on top - the same two files the
 * backend (app/core/bsdate.py) reads, so server and browser can never disagree. See
 * docs/bs-calendar.md.
 */

import calendarData from "./calendar-data.json";
import calendarOverrides from "./calendar-overrides.json";
import { addDays, adDate, diffDays, weekdayOfAd } from "./ad";

export interface BsParts {
  year: number;
  month: number;
  day: number;
}

export interface YearEntry {
  months: number[];
  new_year_ad: string;
}

interface Calendar {
  firstYear: number;
  lastYear: number;
  months: Map<number, number[]>;
  newYear: Map<number, string>;
  /** Day numbers (days since epoch) of every 1 Baisakh, firstYear first. */
  newYearDayNumbers: number[];
  overridden: Set<number>;
  /** Day number of the day after the last supported day. */
  endDayNumber: number;
}

const DAY_MS = 86_400_000;
const dayNumber = (ad: string) => Math.round(adDate(ad).getTime() / DAY_MS);

function yearEntry(year: number, raw: unknown, origin: string): YearEntry {
  const entry = raw as Partial<YearEntry> | null;
  if (!entry || !Array.isArray(entry.months) || typeof entry.new_year_ad !== "string") {
    throw new Error(`${origin}: BS ${year} needs 'months' and 'new_year_ad'`);
  }
  if (entry.months.length !== 12 || !entry.months.every((m) => Number.isInteger(m) && m >= 28 && m <= 32)) {
    throw new Error(`${origin}: BS ${year} must list 12 month lengths of 28-32 days`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.new_year_ad)) {
    throw new Error(`${origin}: BS ${year} new_year_ad must be YYYY-MM-DD`);
  }
  return { months: entry.months.slice(), new_year_ad: entry.new_year_ad };
}

/** Build the table from the data and overrides objects (exported for tests). */
export function loadCalendar(
  data: { years: Record<string, unknown> },
  overrides: { years?: Record<string, unknown> } | null = null,
): Calendar {
  const months = new Map<number, number[]>();
  const newYear = new Map<number, string>();
  for (const [key, raw] of Object.entries(data.years)) {
    const entry = yearEntry(Number(key), raw, "calendar-data.json");
    months.set(Number(key), entry.months);
    newYear.set(Number(key), entry.new_year_ad);
  }
  const overridden = new Set<number>();
  for (const [key, raw] of Object.entries(overrides?.years ?? {})) {
    const entry = yearEntry(Number(key), raw, "calendar-overrides.json");
    months.set(Number(key), entry.months);
    newYear.set(Number(key), entry.new_year_ad);
    overridden.add(Number(key));
  }
  const years = [...months.keys()].sort((a, b) => a - b);
  if (years.length === 0 || years.some((y, i) => y !== years[0] + i)) {
    throw new Error("BS calendar must cover a contiguous range of years");
  }
  for (const year of years.slice(0, -1)) {
    const expected = addDays(newYear.get(year)!, months.get(year)!.reduce((a, b) => a + b, 0));
    if (expected !== newYear.get(year + 1)) {
      const where = overridden.has(year) || overridden.has(year + 1) ? "calendar-overrides.json" : "calendar-data.json";
      throw new Error(`${where}: BS ${year} ends on ${addDays(expected, -1)} but BS ${year + 1} starts on ${newYear.get(year + 1)}`);
    }
  }
  const lastYear = years[years.length - 1];
  return {
    firstYear: years[0],
    lastYear,
    months,
    newYear,
    newYearDayNumbers: years.map((y) => dayNumber(newYear.get(y)!)),
    overridden,
    endDayNumber: dayNumber(newYear.get(lastYear)!) + months.get(lastYear)!.reduce((a, b) => a + b, 0),
  };
}

let calendar: Calendar | null = null;

function table(): Calendar {
  return (calendar ??= loadCalendar(calendarData, calendarOverrides));
}

/** Years the table covers, e.g. [1975, 2100]. */
export function yearRange(): [number, number] {
  const cal = table();
  return [cal.firstYear, cal.lastYear];
}

export function overriddenYears(): number[] {
  return [...table().overridden].sort((a, b) => a - b);
}

export function daysInMonth(year: number, month: number): number {
  const months = table().months.get(year);
  if (!months) throw new RangeError(`BS year ${year} is outside the table (${table().firstYear}-${table().lastYear})`);
  if (month < 1 || month > 12) throw new RangeError(`BS month must be 1-12, got ${month}`);
  return months[month - 1];
}

export function daysInYear(year: number): number {
  return table().months.get(year)?.reduce((a, b) => a + b, 0) ?? daysInMonth(year, 1);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2083-07-07" from parts. */
export function isoBs(year: number, month: number, day: number): string;
export function isoBs(parts: BsParts): string;
export function isoBs(a: number | BsParts, month?: number, day?: number): string {
  const p = typeof a === "number" ? { year: a, month: month!, day: day! } : a;
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Shape check only: "YYYY-M-D" with month 1-12 and day 1-32; null otherwise. */
export function parseBs(value: string): BsParts | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 32) return null;
  return parts;
}

/** Parts of a real BS date (shape, table range and month length), else null. */
export function validBs(value: string | BsParts): BsParts | null {
  const parts = typeof value === "string" ? parseBs(value) : value;
  if (!parts) return null;
  const months = table().months.get(parts.year);
  if (!months || parts.month < 1 || parts.month > 12) return null;
  return parts.day >= 1 && parts.day <= months[parts.month - 1] ? parts : null;
}

export function isValidBs(value: string | BsParts): boolean {
  return validBs(value) !== null;
}

/** "2083-07-07" -> "2026-10-24"; throws on a date that does not exist. */
export function bsToAd(bs: string | BsParts): string {
  const parts = validBs(bs);
  if (!parts) throw new RangeError(`Not a BS date: ${typeof bs === "string" ? bs : isoBs(bs)}`);
  const months = table().months.get(parts.year)!;
  const offset = months.slice(0, parts.month - 1).reduce((a, b) => a + b, 0) + parts.day - 1;
  return addDays(table().newYear.get(parts.year)!, offset);
}

/** "2026-10-24" -> { year: 2083, month: 7, day: 7 }; throws outside the table. */
export function adToBs(ad: string): BsParts {
  const cal = table();
  const n = dayNumber(ad);
  if (n < cal.newYearDayNumbers[0] || n >= cal.endDayNumber) {
    throw new RangeError(`${ad} is outside the BS table (${cal.firstYear}-${cal.lastYear})`);
  }
  let lo = 0;
  let hi = cal.newYearDayNumbers.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cal.newYearDayNumbers[mid] <= n) lo = mid;
    else hi = mid - 1;
  }
  const year = cal.firstYear + lo;
  let remaining = diffDays(cal.newYear.get(year)!, ad);
  const months = cal.months.get(year)!;
  for (let month = 1; month <= 12; month++) {
    if (remaining < months[month - 1]) return { year, month, day: remaining + 1 };
    remaining -= months[month - 1];
  }
  throw new Error("unreachable: day beyond year length");
}

/** "2026-10-24" -> "2083-07-07". */
export function adToBsIso(ad: string): string {
  return isoBs(adToBs(ad));
}

/** 0 = Sunday … 6 = Saturday, for a BS date. */
export function weekdayOfBs(bs: string | BsParts): number {
  return weekdayOfAd(bsToAd(bs));
}

/** BS date `days` days after `bs` (through the AD calendar). */
export function addDaysBs(bs: string, days: number): string {
  return adToBsIso(addDays(bsToAd(bs), days));
}
