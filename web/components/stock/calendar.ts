/**
 * Date helpers for the stock screens, all backed by the shared
 * web/lib/bsdate.ts (which wraps @remotemerge/nepali-date-converter).
 * This file only adapts that API to the shapes the stock module uses
 * (BsDate objects, throwing variants for the mock store) and adds the short
 * AD formats the tables need.
 */

import {
  addDays,
  adFromUtc,
  adToBs as adToBsOrNull,
  adUtc,
  BS_MAX_YEAR,
  BS_MIN_YEAR,
  BS_MONTHS_EN,
  BS_MONTHS_NP,
  bsToAd as bsToAdOrNull,
  daysInBsMonth as daysInBsMonthOrNull,
  formatBs,
  formatBsIso,
  pad2,
  parseBs,
  SATURDAY,
  todayAd,
  toNepaliDigits,
  WEEKDAY_INITIALS_NP,
  WEEKDAYS_NP,
  weekdayOf,
  type BsDate,
} from "@/lib/bsdate";

export { addDays, adFromUtc, adUtc, formatBsIso, pad2, SATURDAY, todayAd, WEEKDAY_INITIALS_NP, weekdayOf };
export type { BsDate };

export const WEEKDAY_NAMES_NP = WEEKDAYS_NP;
export const WEEKDAY_SHORT_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function bsSupported(year: number): boolean {
  return year >= BS_MIN_YEAR && year <= BS_MAX_YEAR;
}

/** Days in a BS month; throws outside the converter's table. */
export function daysInBsMonth(year: number, month: number): number {
  const days = daysInBsMonthOrNull(year, month);
  if (days === null) throw new RangeError(`BS ${year}-${month} is outside the calendar table`);
  return days;
}

/** Parses "YYYY-MM-DD" (BS) into parts; null when malformed or not a real date. */
export function parseBsIso(value: string): BsDate | null {
  const parts = parseBs(value);
  if (!parts || bsToAdOrNull(parts) === null) return null;
  return parts;
}

/** AD "YYYY-MM-DD" for a BS date; throws for a date outside the table. */
export function bsToAd(d: BsDate): string {
  const ad = bsToAdOrNull(d);
  if (ad === null) throw new RangeError(`${formatBsIso(d)} is not a valid BS date`);
  return ad;
}

/** BS parts for an AD "YYYY-MM-DD"; throws outside the table. */
export function adToBs(ad: string): BsDate {
  const bs = adToBsOrNull(ad);
  if (bs === null) throw new RangeError(`${ad} is outside the BS calendar table`);
  return bs;
}

export function isSaturday(ad: string): boolean {
  return weekdayOf(ad) === SATURDAY;
}

export function bsMonthName(month: number): string {
  return BS_MONTHS_EN[month - 1];
}

export function bsMonthNameNp(month: number): string {
  return BS_MONTHS_NP[month - 1];
}

/** "Kartik 4, 2083" */
export function formatBsLong(d: BsDate): string {
  return formatBs(d);
}

export const toDevanagari = toNepaliDigits;

/** "कार्तिक ४, २०८३" */
export function formatBsLongNp(d: BsDate): string {
  return formatBs(d, { lang: "ne" });
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
