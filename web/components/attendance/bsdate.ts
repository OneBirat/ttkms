/**
 * Bikram Sambat helpers for the attendance module.
 *
 * Re-exports the shared names from web/lib/bsdate.ts and adds the conversions
 * the screens need, built on @remotemerge/nepali-date-converter (already a
 * dependency on main). NEEDS FROM MAIN: fold adToBs / bsToAd / daysInBsMonth /
 * WEEKDAY_INITIALS_NP into web/lib/bsdate.ts; this file then shrinks to a
 * re-export.
 *
 * All AD dates are "YYYY-MM-DD" strings handled as UTC calendar days, so no
 * browser time-zone shifts a date. "Today" is taken in Asia/Kathmandu.
 */

import DateConverter from "@remotemerge/nepali-date-converter";
import { BS_MONTHS_EN, BS_MONTHS_NP, parseBs, toDevanagariDigits } from "@/lib/bsdate";
import type { BsParts } from "@/lib/bsdate";
import type { DayHeader } from "./types";

export { BS_MONTHS_EN, BS_MONTHS_NP, parseBs, toDevanagariDigits };
export type { BsParts };

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

const MONTHS_SHORT_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const TIMEZONE = "Asia/Kathmandu";

const pad = (n: number) => String(n).padStart(2, "0");

export function isoBs(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

// ------------------------------------------------------------ AD arithmetic

function parseAd(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function isoAd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(iso: string, days: number): string {
  const d = parseAd(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return isoAd(d);
}

/** Days between two ISO dates (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((parseAd(b).getTime() - parseAd(a).getTime()) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOfAd(iso: string): number {
  return parseAd(iso).getUTCDay();
}

/** Today's AD date in Kathmandu as "YYYY-MM-DD". */
export function todayAd(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// ------------------------------------------------------------ conversions

/** "2026-10-21" -> { year: 2083, month: 7, day: 4 } */
export function adToBs(ad: string): BsParts {
  const r = new DateConverter(ad).toBs();
  return { year: r.year, month: r.month, day: r.date };
}

/** "2083-07-04" -> "2026-10-21"; throws on an unparseable BS date. */
export function bsToAd(bs: string): string {
  const parts = parseBs(bs);
  if (!parts) throw new Error(`Not a BS date: ${bs}`);
  const r = new DateConverter(isoBs(parts.year, parts.month, parts.day)).toAd();
  return isoAd(new Date(Date.UTC(r.year, r.month - 1, r.date)));
}

/** Length of a BS month: the distance to the first day of the next month. */
export function daysInBsMonth(year: number, month: number): number {
  const first = bsToAd(isoBs(year, month, 1));
  const next = month === 12 ? bsToAd(isoBs(year + 1, 1, 1)) : bsToAd(isoBs(year, month + 1, 1));
  return diffDays(first, next);
}

/** Is this a real BS date (within the converter's range and the month's length)? */
export function isValidBs(bs: string): boolean {
  const parts = parseBs(bs);
  if (!parts) return false;
  try {
    return parts.day <= daysInBsMonth(parts.year, parts.month);
  } catch {
    return false;
  }
}

/** Day headers of a BS month (weekly off marked). */
export function bsMonthDays(year: number, month: number, weeklyOff: number): DayHeader[] {
  const first = bsToAd(isoBs(year, month, 1));
  const length = daysInBsMonth(year, month);
  const days: DayHeader[] = [];
  for (let i = 0; i < length; i++) {
    const ad = addDays(first, i);
    const weekday = weekdayOfAd(ad);
    days.push({
      bs_date: isoBs(year, month, i + 1),
      bs_day: i + 1,
      ad_date: ad,
      weekday,
      is_weekly_off: weekday === weeklyOff,
    });
  }
  return days;
}

/** Day header for one BS date; null when the date does not exist. */
export function bsDayHeader(bs: string, weeklyOff: number): DayHeader | null {
  if (!isValidBs(bs)) return null;
  const parts = parseBs(bs)!;
  const ad = bsToAd(bs);
  const weekday = weekdayOfAd(ad);
  return {
    bs_date: bs,
    bs_day: parts.day,
    ad_date: ad,
    weekday,
    is_weekly_off: weekday === weeklyOff,
  };
}

// ------------------------------------------------------------ month keys

export function monthKey(year: number, month: number): string {
  return `${year}-${pad(month)}`;
}

export function parseMonthKey(key: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{1,2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { year, month } : null;
}

/** Month `delta` months before (negative) or after a given month. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function monthName(month: number): string {
  return BS_MONTHS_EN[month - 1];
}

export function monthLabel(year: number, month: number): string {
  return `${BS_MONTHS_EN[month - 1]} ${year}`;
}

export function monthLabelNp(year: number, month: number): string {
  return `${BS_MONTHS_NP[month - 1]} ${toDevanagariDigits(year)}`;
}

// ------------------------------------------------------------ formatting

/** weekdayInitial(6) -> "श"; out-of-range values wrap like Date#getDay. */
export function weekdayInitial(weekday: number): string {
  return WEEKDAY_INITIALS_NP[((weekday % 7) + 7) % 7];
}

/** "आ आइत · सो सोम · …" for the legend. */
export function weekdayKeyText(): string {
  return WEEKDAY_INITIALS_NP.map(
    (initial, i) => `${initial} ${WEEKDAY_NAMES_NP[i].replace(/बार$/, "")}`,
  ).join(" · ");
}

/** "2083-07-04" -> "Kartik 4, 2083" */
export function bsText(bs: string): string {
  const p = parseBs(bs);
  return p ? `${BS_MONTHS_EN[p.month - 1]} ${p.day}, ${p.year}` : bs;
}

/** "2083-07-04" (Wednesday) -> "बुधबार, कार्तिक ४" */
export function bsTextNp(bs: string, weekday: number): string {
  const p = parseBs(bs);
  if (!p) return bs;
  return `${WEEKDAY_NAMES_NP[((weekday % 7) + 7) % 7]}, ${BS_MONTHS_NP[p.month - 1]} ${toDevanagariDigits(p.day)}`;
}

/** "2083-07-04" (Wednesday) -> "बुधबार, कार्तिक ४, २०८३" */
export function bsTextNpFull(bs: string, weekday: number): string {
  const p = parseBs(bs);
  if (!p) return bs;
  return `${bsTextNp(bs, weekday)}, ${toDevanagariDigits(p.year)}`;
}

/** "2026-09-17" -> "17 Sep" (or "17 Sep 2026" with `withYear`). */
export function formatAdShort(iso: string, withYear = false): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS_SHORT_EN[m - 1]}${withYear ? ` ${y}` : ""}`;
}

/** "17 Sep – 16 Oct 2026" (year shown once when it does not change). */
export function formatAdRange(start: string, end: string): string {
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${formatAdShort(start, !sameYear)} – ${formatAdShort(end, true)}`;
}

/** "2026-10-21" -> "Wed 21 Oct 2026" */
export function formatAdWeekday(iso: string): string {
  return `${WEEKDAY_NAMES_EN[weekdayOfAd(iso)].slice(0, 3)} ${formatAdShort(iso, true)}`;
}
