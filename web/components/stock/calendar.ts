/**
 * MOCK-ONLY Bikram Sambat calendar for the stock UI.
 *
 * The shared BS utilities (web/lib/bsdate.ts, app/core/bsdate.py) only
 * convert through the API once the vendor month table has been ported, so
 * the mock layer needs a small client-side table to build calendar grids and
 * date-grouped history. It covers BS 2081–2084 and matches the dates used in
 * the approved design (Kartik 1, 2083 = 17 Oct 2026).
 *
 * TODO(shared): replace with the shared client-side BS helpers once
 * scripts/port_bs_calendar.py has produced the real table. Do not use this
 * file for anything stored in the database.
 */

import { BS_MONTHS_EN, BS_MONTHS_NP } from "./bsNames";

/** Month lengths, index 0 = Baishakh. */
const MONTH_DAYS: Record<number, number[]> = {
  2081: [31, 31, 32, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2082: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2083: [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 29, 31],
  2084: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
};

/** BS 2081-01-01 = AD 2024-04-13. */
const ANCHOR_BS = { year: 2081, month: 1, day: 1 };
const ANCHOR_AD = Date.UTC(2024, 3, 13);

const MS_PER_DAY = 86_400_000;

export const WEEKDAY_INITIALS_NP = ["आ", "सो", "मं", "बु", "बि", "शु", "श"] as const;
export const WEEKDAY_NAMES_NP = [
  "आइतबार",
  "सोमबार",
  "मंगलबार",
  "बुधबार",
  "बिहिबार",
  "शुक्रबार",
  "शनिबार",
] as const;
export const WEEKDAY_SHORT_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const SATURDAY = 6;

export interface BsDate {
  year: number;
  month: number;
  day: number;
}

export function daysInBsMonth(year: number, month: number): number {
  const table = MONTH_DAYS[year];
  if (!table) throw new RangeError(`BS year ${year} is outside the mock table`);
  return table[month - 1];
}

export function bsSupported(year: number): boolean {
  return year in MONTH_DAYS;
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatBsIso(d: BsDate): string {
  return `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;
}

/** Parses "YYYY-MM-DD" (BS) into parts; null when malformed or outside the table. */
export function parseBsIso(value: string): BsDate | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!bsSupported(year) || month < 1 || month > 12) return null;
  if (day < 1 || day > daysInBsMonth(year, month)) return null;
  return { year, month, day };
}

/** Days since the anchor for a BS date. */
function bsOrdinal(d: BsDate): number {
  let days = 0;
  for (let y = ANCHOR_BS.year; y < d.year; y++) {
    days += MONTH_DAYS[y].reduce((a, b) => a + b, 0);
  }
  for (let m = 1; m < d.month; m++) days += daysInBsMonth(d.year, m);
  return days + (d.day - 1);
}

/** AD "YYYY-MM-DD" for a BS date. */
export function bsToAd(d: BsDate): string {
  return adFromUtc(ANCHOR_AD + bsOrdinal(d) * MS_PER_DAY);
}

/** BS parts for an AD "YYYY-MM-DD". */
export function adToBs(ad: string): BsDate {
  let remaining = Math.round((adUtc(ad) - ANCHOR_AD) / MS_PER_DAY);
  if (remaining < 0) throw new RangeError(`${ad} is before the mock table`);
  let year = ANCHOR_BS.year;
  for (;;) {
    const table = MONTH_DAYS[year];
    if (!table) throw new RangeError(`${ad} is after the mock table`);
    const inYear = table.reduce((a, b) => a + b, 0);
    if (remaining < inYear) break;
    remaining -= inYear;
    year += 1;
  }
  let month = 1;
  while (remaining >= daysInBsMonth(year, month)) {
    remaining -= daysInBsMonth(year, month);
    month += 1;
  }
  return { year, month, day: remaining + 1 };
}

export function adUtc(ad: string): number {
  const [y, m, d] = ad.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function adFromUtc(utc: number): string {
  const date = new Date(utc);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** AD date shifted by `days` (negative = earlier). */
export function addDays(ad: string, days: number): string {
  return adFromUtc(adUtc(ad) + days * MS_PER_DAY);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(ad: string): number {
  return new Date(adUtc(ad)).getUTCDay();
}

export function isSaturday(ad: string): boolean {
  return weekdayOf(ad) === SATURDAY;
}

/** Today's AD date in the browser's local time (the shop's clock). */
export function todayAd(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

export function bsMonthName(month: number): string {
  return BS_MONTHS_EN[month - 1];
}

export function bsMonthNameNp(month: number): string {
  return BS_MONTHS_NP[month - 1];
}

/** "Kartik 4, 2083" */
export function formatBsLong(d: BsDate): string {
  return `${bsMonthName(d.month)} ${d.day}, ${d.year}`;
}

const DEVANAGARI = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"];

export function toDevanagari(value: string | number): string {
  return String(value).replace(/[0-9]/g, (c) => DEVANAGARI[Number(c)]);
}

/** "कार्तिक ४, २०८३" */
export function formatBsLongNp(d: BsDate): string {
  return `${bsMonthNameNp(d.month)} ${toDevanagari(d.day)}, ${toDevanagari(d.year)}`;
}

const AD_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "20 Oct 2026" */
export function formatAdLong(ad: string): string {
  const [y, m, d] = ad.split("-").map(Number);
  return `${d} ${AD_MONTHS[m - 1]} ${y}`;
}

/** "20 Oct" */
export function formatAdShort(ad: string): string {
  const [, m, d] = ad.split("-").map(Number);
  return `${d} ${AD_MONTHS[m - 1]}`;
}

/** The previous BS month as {year, month}. */
export function previousBsMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function nextBsMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/** Compare two BS ISO strings; works lexically because they are zero-padded. */
export function compareBs(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
