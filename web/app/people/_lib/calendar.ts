/**
 * Bikram Sambat calendar helpers for the People screens, built on
 * @remotemerge/nepali-date-converter (already a dependency on main) and the
 * shared month names in web/lib/bsdate.ts. Nothing here is mock data: the
 * backend produces the same values from app/core/bsdate.py.
 *
 * NEEDS FROM MAIN: adToBs / bsToAd / daysInBsMonth / todayAd belong in
 * web/lib/bsdate.ts (the attendance worktree has the same copies).
 */

import DateConverter from "@remotemerge/nepali-date-converter";
import { BS_MONTHS_EN, BS_MONTHS_NP, parseBs } from "@/lib/bsdate";
import type { BsMonth, DateBoth, DateRange, RangePreset } from "../types";

export { BS_MONTHS_EN, BS_MONTHS_NP };

export const TIMEZONE = "Asia/Kathmandu";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function isoBs(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function isoAd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Today's AD date in Kathmandu as "YYYY-MM-DD". */
export function todayAd(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export interface BsParts {
  year: number;
  month: number;
  day: number;
}

/** "2026-10-24" -> { year: 2083, month: 7, day: 7 } */
export function adToBs(ad: string): BsParts {
  const r = new DateConverter(ad).toBs();
  return { year: r.year, month: r.month, day: r.date };
}

/** "2083-07-07" -> "2026-10-24"; throws on an unparseable BS date. */
export function bsToAd(bs: string): string {
  const parts = parseBs(bs);
  if (!parts) throw new Error(`Not a BS date: ${bs}`);
  const r = new DateConverter(isoBs(parts.year, parts.month, parts.day)).toAd();
  return isoAd(new Date(Date.UTC(r.year, r.month - 1, r.date)));
}

export function addDaysAd(ad: string, days: number): string {
  const [y, m, d] = ad.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return isoAd(date);
}

function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOfAd(ad: string): number {
  const [y, m, d] = ad.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Length of a BS month: the distance to the first day of the next month. */
export function daysInMonth(month: BsMonth): number {
  const first = bsToAd(isoBs(month.bs_year, month.bs_month, 1));
  const next = monthStartAd(addMonths(month, 1));
  return diffDays(first, next);
}

/** Saturdays in a BS month (the weekly off). */
export function saturdaysInMonth(month: BsMonth, upToDay: number | null = null): number {
  const first = monthStartAd(month);
  const length = upToDay ?? daysInMonth(month);
  let count = 0;
  for (let i = 0; i < length; i += 1) {
    if (weekdayOfAd(addDaysAd(first, i)) === 6) count += 1;
  }
  return count;
}

export function monthStartAd(month: BsMonth): string {
  return bsToAd(isoBs(month.bs_year, month.bs_month, 1));
}

export function monthStart(month: BsMonth): DateBoth {
  return dateBoth(isoBs(month.bs_year, month.bs_month, 1));
}

export function monthEnd(month: BsMonth): DateBoth {
  return dateBoth(isoBs(month.bs_year, month.bs_month, daysInMonth(month)));
}

/** Both calendars for a BS date string. */
export function dateBoth(bs: string): DateBoth {
  return { bs, ad: bsToAd(bs) };
}

/** Both calendars for an AD date string. */
export function dateBothFromAd(ad: string): DateBoth {
  const p = adToBs(ad);
  return { bs: isoBs(p.year, p.month, p.day), ad };
}

/** Today, BS first. */
export function today(now: Date = new Date()): DateBoth {
  return dateBothFromAd(todayAd(now));
}

/** The BS month that is running today. */
export function thisMonth(now: Date = new Date()): BsMonth {
  const t = adToBs(todayAd(now));
  return { bs_year: t.year, bs_month: t.month };
}

/** Is this a real BS date (shape, converter range and month length)? */
export function isValidBs(bs: string): boolean {
  const parts = parseBs(bs);
  if (!parts) return false;
  try {
    return parts.day <= daysInMonth({ bs_year: parts.year, bs_month: parts.month });
  } catch {
    return false;
  }
}

// ------------------------------------------------------------ months

export function monthKey(month: BsMonth): string {
  return `${month.bs_year}-${pad(month.bs_month)}`;
}

export function parseMonthKey(key: string): BsMonth | null {
  const match = /^(\d{4})-(\d{1,2})$/.exec(key);
  if (!match) return null;
  const bs_month = Number(match[2]);
  if (bs_month < 1 || bs_month > 12) return null;
  return { bs_year: Number(match[1]), bs_month };
}

export function sameMonth(a: BsMonth, b: BsMonth): boolean {
  return a.bs_year === b.bs_year && a.bs_month === b.bs_month;
}

/** "Kartik 2083" */
export function monthLabel(month: BsMonth): string {
  return `${BS_MONTHS_EN[month.bs_month - 1]} ${month.bs_year}`;
}

/** "Kartik" */
export function monthName(month: BsMonth): string {
  return BS_MONTHS_EN[month.bs_month - 1];
}

/** "कार्तिक" */
export function monthNameNp(month: BsMonth): string {
  return BS_MONTHS_NP[month.bs_month - 1];
}

export function addMonths(month: BsMonth, delta: number): BsMonth {
  const index = month.bs_year * 12 + (month.bs_month - 1) + delta;
  return { bs_year: Math.floor(index / 12), bs_month: (index % 12) + 1 };
}

/** Negative when a is before b. */
export function compareMonths(a: BsMonth, b: BsMonth): number {
  return a.bs_year * 12 + a.bs_month - (b.bs_year * 12 + b.bs_month);
}

/** Month of a BS date string (null when unparsable). */
export function monthOf(bs: string): BsMonth | null {
  const parts = parseBs(bs);
  return parts ? { bs_year: parts.year, bs_month: parts.month } : null;
}

// --------------------------------------------------------- formatting

/** "Kartik 7, 2083" from "2083-07-07"; invalid input is returned as is. */
export function formatBsLong(bs: string): string {
  const parts = parseBs(bs);
  if (!parts) return bs;
  return `${BS_MONTHS_EN[parts.month - 1]} ${parts.day}, ${parts.year}`;
}

/** "Kartik 7" (no year) */
export function formatBsDay(bs: string): string {
  const parts = parseBs(bs);
  if (!parts) return bs;
  return `${BS_MONTHS_EN[parts.month - 1]} ${parts.day}`;
}

/** "07-02" (month-day) for compact pills such as "Paid 07-02". */
export function formatBsShort(bs: string): string {
  const parts = parseBs(bs);
  if (!parts) return bs;
  return `${pad(parts.month)}-${pad(parts.day)}`;
}

const AD_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "24 Oct 2026" from "2026-10-24". */
export function formatAd(ad: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ad);
  if (!match) return ad;
  return `${Number(match[3])} ${AD_MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

/** "24 Oct" */
export function formatAdShort(ad: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ad);
  if (!match) return ad;
  return `${Number(match[3])} ${AD_MONTHS[Number(match[2]) - 1]}`;
}

/** "Kartik 7, 2083 · 24 Oct 2026" */
export function formatDateBoth(date: DateBoth): string {
  return `${formatBsLong(date.bs)} · ${formatAd(date.ad)}`;
}

/** "Kartik 1 – 30, 2083 · 18 Oct – 16 Nov 2026" */
export function formatMonthRange(month: BsMonth): string {
  const start = monthStart(month);
  const end = monthEnd(month);
  return `${monthName(month)} 1 – ${daysInMonth(month)}, ${month.bs_year} · ${formatAdShort(start.ad)} – ${formatAd(end.ad)}`;
}

// ---------------------------------------------------------- Devanagari

const NP_DIGITS = "०१२३४५६७८९";

/** 2083 -> "२०८३" (every ASCII digit swapped). */
export function toNepaliDigits(value: number | string): string {
  return String(value).replace(/\d/g, (d) => NP_DIGITS[Number(d)]);
}

/** "कार्तिक ४, २०८३" from "2083-07-04". */
export function formatBsNp(bs: string): string {
  const parts = parseBs(bs);
  if (!parts) return bs;
  return `${BS_MONTHS_NP[parts.month - 1]} ${toNepaliDigits(parts.day)}, ${toNepaliDigits(parts.year)}`;
}

/** "कार्तिक ४" */
export function formatBsDayNp(bs: string): string {
  const parts = parseBs(bs);
  if (!parts) return bs;
  return `${BS_MONTHS_NP[parts.month - 1]} ${toNepaliDigits(parts.day)}`;
}

/** "कार्तिक २०८३" */
export function monthLabelNp(month: BsMonth): string {
  return `${BS_MONTHS_NP[month.bs_month - 1]} ${toNepaliDigits(month.bs_year)}`;
}

// -------------------------------------------------------------- ranges

/** BS date `days` days after `bs` (through the AD calendar). */
export function addDaysBs(bs: string, days: number): string {
  return dateBothFromAd(addDaysAd(bsToAd(bs), days)).bs;
}

/** ISO-shaped BS strings compare as text. */
export function compareBs(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The register presets, all inclusive and ending today (last month: its last day). */
export function rangeFor(preset: RangePreset, now: Date = new Date()): DateRange {
  const t = today(now);
  const month = thisMonth(now);
  switch (preset) {
    case "this_month":
      return { from_bs: monthStart(month).bs, to_bs: t.bs };
    case "last_month": {
      const previous = addMonths(month, -1);
      return { from_bs: monthStart(previous).bs, to_bs: monthEnd(previous).bs };
    }
    case "last_30":
      return { from_bs: addDaysBs(t.bs, -29), to_bs: t.bs };
    case "last_3":
      return { from_bs: monthStart(addMonths(month, -2)).bs, to_bs: t.bs };
  }
}

export const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "last_30", label: "Last 30 days" },
  { value: "last_3", label: "Last 3 months" },
];

/** Which preset a range equals, if any. */
export function presetOf(range: DateRange, now: Date = new Date()): RangePreset | null {
  for (const preset of RANGE_PRESETS) {
    const r = rangeFor(preset.value, now);
    if (r.from_bs === range.from_bs && r.to_bs === range.to_bs) return preset.value;
  }
  return null;
}

/** "17 Sep – 16 Oct 2026" */
export function formatAdRange(fromAd: string, toAd: string): string {
  return `${formatAdShort(fromAd)} – ${formatAd(toAd)}`;
}

/** "Ashoj 1 – Kartik 4, 2083" for a BS range (same year shown once). */
export function formatBsRange(from_bs: string, to_bs: string): string {
  const a = parseBs(from_bs);
  const b = parseBs(to_bs);
  if (!a || !b) return `${from_bs} → ${to_bs}`;
  if (a.year === b.year && a.month === b.month) {
    return `${BS_MONTHS_EN[a.month - 1]} ${a.day} – ${b.day}, ${a.year}`;
  }
  if (a.year === b.year) {
    return `${BS_MONTHS_EN[a.month - 1]} ${a.day} – ${BS_MONTHS_EN[b.month - 1]} ${b.day}, ${a.year}`;
  }
  return `${formatBsLong(from_bs)} – ${formatBsLong(to_bs)}`;
}
