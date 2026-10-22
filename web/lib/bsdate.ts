/**
 * SHARED — move to main later (attendance/payroll need it too).
 *
 * Bikram Sambat (BS) ↔ Gregorian (AD) dates for the browser. The conversion
 * table comes from @remotemerge/nepali-date-converter (BS 1975–2099); nothing
 * else imports that package directly. Nepali month names, weekday names and
 * Devanagari digits are added here because the package has none.
 *
 * Dates travel as "YYYY-MM-DD" strings (zero-padded) in both calendars.
 * Conversion functions return null instead of throwing for invalid or
 * out-of-range input.
 */

import DateConverter from "@remotemerge/nepali-date-converter";
import type { BsConvertResponse } from "@/lib/api";

export interface BsDate {
  year: number;
  month: number;
  day: number;
}

/** @deprecated name kept for existing callers; same shape as BsDate. */
export type BsParts = BsDate;

/** Bikram Sambat month names, index 0 = Baisakh. */
export const BS_MONTHS_EN = [
  "Baisakh",
  "Jestha",
  "Asar",
  "Shrawan",
  "Bhadra",
  "Asoj",
  "Kartik",
  "Mangsir",
  "Poush",
  "Magh",
  "Falgun",
  "Chaitra",
] as const;

export const BS_MONTHS_NP = [
  "बैशाख",
  "जेठ",
  "असार",
  "साउन",
  "भदौ",
  "असोज",
  "कार्तिक",
  "मंसिर",
  "पुस",
  "माघ",
  "फागुन",
  "चैत",
] as const;

/** Weekday names, index 0 = Sunday. */
export const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const WEEKDAYS_NP = ["आइतबार", "सोमबार", "मंगलबार", "बुधबार", "बिहीबार", "शुक्रबार", "शनिबार"] as const;
/** Single-letter weekday initials for calendar grids (आ सो मं बु बि शु श). */
export const WEEKDAY_INITIALS_NP = ["आ", "सो", "मं", "बु", "बि", "शु", "श"] as const;

/** Saturday is the weekly off. */
export const SATURDAY = 6;

/** The converter's table covers these BS years. */
export const BS_MIN_YEAR = 1975;
export const BS_MAX_YEAR = 2099;

const NEPALI_DIGITS = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"];

/** 2083 -> "२०८३"; non-digit characters are kept as they are. */
export function toNepaliDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (d) => NEPALI_DIGITS[Number(d)]);
}

/** @deprecated use toNepaliDigits. */
export const toDevanagariDigits = toNepaliDigits;

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** {2083, 7, 4} -> "2083-07-04" */
export function formatBsIso(d: BsDate): string {
  return `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;
}

/**
 * Splits "YYYY-MM-DD" (BS) into parts; null when the shape or ranges are
 * wrong. Only the shape is checked (day 1–32): use isValidBs/bsToAd to know
 * whether the day exists in that month.
 */
export function parseBs(value: string): BsDate | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 32) return null;
  return { year, month, day };
}

const AD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealAd(ad: string): boolean {
  const m = AD_RE.exec(ad);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** "2026-10-20" -> {2083, 7, 4}; null for a malformed date or one outside BS 1975–2099. */
export function adToBs(ad: string): BsDate | null {
  if (!isRealAd(ad)) return null;
  try {
    const r = new DateConverter(ad).toBs();
    return { year: r.year, month: r.month, day: r.date };
  } catch {
    return null;
  }
}

/** "2083-07-04" -> "2026-10-20"; null for a malformed date, a day that does not exist, or a year outside the table. */
export function bsToAd(bs: string | BsDate): string | null {
  const parts = typeof bs === "string" ? parseBs(bs) : bs;
  if (!parts || parts.year < BS_MIN_YEAR || parts.year > BS_MAX_YEAR) return null;
  try {
    const r = new DateConverter(formatBsIso(parts)).toAd();
    const ad = `${r.year}-${pad2(r.month)}-${pad2(r.date)}`;
    // The converter accepts e.g. day 32 in a 30-day month and rolls over; only
    // accept input that converts back to itself.
    const back = adToBs(ad);
    if (!back || back.year !== parts.year || back.month !== parts.month || back.day !== parts.day) return null;
    return ad;
  } catch {
    return null;
  }
}

/** True when "YYYY-MM-DD" is a real BS date inside the table. */
export function isValidBs(bs: string): boolean {
  return bsToAd(bs) !== null;
}

/** Days in a BS month, or null outside the table. */
export function daysInBsMonth(year: number, month: number): number | null {
  const first = bsToAd({ year, month, day: 1 });
  const nextFirst = month === 12 ? bsToAd({ year: year + 1, month: 1, day: 1 }) : bsToAd({ year, month: month + 1, day: 1 });
  if (!first || !nextFirst) return null;
  return Math.round((adUtc(nextFirst) - adUtc(first)) / MS_PER_DAY);
}

// ---------------------------------------------------------------- AD helpers

const MS_PER_DAY = 86_400_000;

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

/** Today's AD date in Asia/Kathmandu (the shop's clock), so the date flips at local midnight. */
export function todayAd(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kathmandu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Today's BS date ("YYYY-MM-DD") in Asia/Kathmandu. */
export function todayBs(now: Date = new Date()): string {
  const bs = adToBs(todayAd(now));
  if (!bs) throw new RangeError("today is outside the BS table");
  return formatBsIso(bs);
}

// ---------------------------------------------------------------- formatting

export interface FormatBsOptions {
  lang?: "ne" | "en";
  /** Prefix the weekday ("मंगलबार, " / "Tuesday, "). Needs a valid date. */
  weekday?: boolean;
}

/**
 * formatBs("2083-07-04") -> "Kartik 4, 2083"
 * formatBs("2083-07-04", { lang: "ne", weekday: true }) -> "मंगलबार, कार्तिक ४, २०८३"
 * Invalid string input is returned unchanged.
 */
export function formatBs(bs: string | BsDate, options: FormatBsOptions = {}): string {
  const parts = typeof bs === "string" ? parseBs(bs) : bs;
  if (!parts) return typeof bs === "string" ? bs : "";
  const lang = options.lang ?? "en";
  const body =
    lang === "ne"
      ? `${BS_MONTHS_NP[parts.month - 1]} ${toNepaliDigits(parts.day)}, ${toNepaliDigits(parts.year)}`
      : `${BS_MONTHS_EN[parts.month - 1]} ${parts.day}, ${parts.year}`;
  if (!options.weekday) return body;
  const ad = bsToAd(parts);
  if (!ad) return body;
  const weekday = weekdayOf(ad);
  return `${lang === "ne" ? WEEKDAYS_NP[weekday] : WEEKDAYS_EN[weekday]}, ${body}`;
}

/** formatBsNp("2083-07-04") -> "कार्तिक ४, २०८३" */
export function formatBsNp(value: string): string {
  return formatBs(value, { lang: "ne" });
}

const AD_MONTHS_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** formatAd("2026-10-20") -> "Tuesday, 20 October 2026"; invalid input is returned unchanged. */
export function formatAd(ad: string): string {
  if (!isRealAd(ad)) return ad;
  const [y, m, d] = ad.split("-").map(Number);
  return `${WEEKDAYS_EN[weekdayOf(ad)]}, ${d} ${AD_MONTHS_EN[m - 1]} ${y}`;
}

// ------------------------------------------------------------ API converters

/**
 * Converts through GET /api/bsdate/convert (the backend's table). Kept for
 * parity checks; the UI converts locally with adToBs/bsToAd.
 */
export async function convertAdToBs(ad: string, signal?: AbortSignal): Promise<BsConvertResponse> {
  const { apiFetch } = await import("@/lib/api");
  return apiFetch<BsConvertResponse>(`/api/bsdate/convert?ad=${encodeURIComponent(ad)}`, { signal });
}

export async function convertBsToAd(bs: string, signal?: AbortSignal): Promise<BsConvertResponse> {
  const { apiFetch } = await import("@/lib/api");
  return apiFetch<BsConvertResponse>(`/api/bsdate/convert?bs=${encodeURIComponent(bs)}`, { signal });
}
