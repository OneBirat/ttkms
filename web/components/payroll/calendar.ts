/**
 * MOCK Bikram Sambat calendar for the payroll UI.
 *
 * The real month table arrives with the BS date-picker port (app/core/bsdate);
 * until then the payroll mock needs month names, a days-in-month figure and
 * an AD date for every BS date it shows. These values are sample data for
 * 2083 only, never a calendar source: the backend returns days_in_month in
 * MonthSummary and both calendars in every DateBoth, and the UI uses those.
 */

import { BS_MONTHS_EN, BS_MONTHS_NP } from "@/lib/bsdate";
import type { BsMonth, DateBoth } from "./types";

export { BS_MONTHS_EN, BS_MONTHS_NP };

/** Sample day counts for 2083 (a common BS year pattern; sums to 365). */
const MOCK_DAYS_2083 = [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30];

/** Baishakh 1, 2083 as an AD date (sample). */
const MOCK_YEAR_START_AD = new Date(Date.UTC(2026, 3, 14));

/**
 * The payroll month the mock treats as the open run: Ashwin 2083, the month
 * that just ended (today is Kartik 6 in the mock, so Ashwin's salaries are
 * being paid now).
 */
export const CURRENT_MONTH: BsMonth = { bs_year: 2083, bs_month: 6 };

/** Today in the mock, BS first. */
export const TODAY: DateBoth = { bs: "2083-07-06", ad: "2026-10-23" };

export function monthKey(month: BsMonth): string {
  return `${month.bs_year}-${String(month.bs_month).padStart(2, "0")}`;
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

/** Mock days in a BS month (the backend's MonthSummary.days_in_month wins). */
export function mockDaysInMonth(month: BsMonth): number {
  return MOCK_DAYS_2083[month.bs_month - 1];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "2083-07-06" -> { year, month, day } or null. */
export function parseBsDate(
  value: string,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 32) return null;
  return { year, month, day };
}

/** Mock BS -> AD conversion for 2083 dates. */
export function mockBsToAd(bs: string): string {
  const parts = parseBsDate(bs);
  if (!parts) return "";
  let days = parts.day - 1;
  for (let m = 0; m < parts.month - 1; m += 1) days += MOCK_DAYS_2083[m];
  const yearOffset = (parts.year - 2083) * 365;
  const ad = new Date(MOCK_YEAR_START_AD.getTime());
  ad.setUTCDate(ad.getUTCDate() + days + yearOffset);
  return `${ad.getUTCFullYear()}-${pad(ad.getUTCMonth() + 1)}-${pad(ad.getUTCDate())}`;
}

export function dateBoth(bs: string): DateBoth {
  return { bs, ad: mockBsToAd(bs) };
}

/** First day of a month as a BS date string. */
export function monthStart(month: BsMonth): string {
  return `${month.bs_year}-${pad(month.bs_month)}-01`;
}

/** Month of a BS date string (null when unparsable). */
export function monthOf(bs: string): BsMonth | null {
  const parts = parseBsDate(bs);
  return parts ? { bs_year: parts.year, bs_month: parts.month } : null;
}

/** "Kartik 6, 2083" from "2083-07-06"; invalid input is returned as is. */
export function formatBsLong(bs: string): string {
  const parts = parseBsDate(bs);
  if (!parts) return bs;
  return `${BS_MONTHS_EN[parts.month - 1]} ${parts.day}, ${parts.year}`;
}

/** "07-02" (month-day) for compact pills such as "Paid 07-02". */
export function formatBsShort(bs: string): string {
  const parts = parseBsDate(bs);
  if (!parts) return bs;
  return `${pad(parts.month)}-${pad(parts.day)}`;
}

/** "23 Oct 2026" from "2026-10-23". */
export function formatAd(ad: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ad);
  if (!match) return ad;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

/** "Kartik 6, 2083 · 23 Oct 2026" */
export function formatDateBoth(date: DateBoth): string {
  return `${formatBsLong(date.bs)} · ${formatAd(date.ad)}`;
}
