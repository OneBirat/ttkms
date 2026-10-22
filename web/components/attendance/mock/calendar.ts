/**
 * MOCK Bikram Sambat months for the attendance UI session only.
 *
 * The real month lengths come from the backend (app/core/bsdate.py, once the
 * vendor table is ported) and every API response carries both BS and AD dates,
 * so nothing outside mock/ may rely on this table. The two months below follow
 * the approved design: Ashoj 2083 = 17 Sep – 16 Oct 2026 and Kartik 4 = 20 Oct.
 * Kartik's length is a placeholder (TODO backend: real days_in_month).
 */

import { BS_MONTHS_EN, BS_MONTHS_NP, toDevanagariDigits } from "@/lib/bsdate";
import type { BsMonthRef, DayHeader, MonthOption, TodayRef } from "../types";
import { WEEKDAY_NAMES_NP } from "../helpers";

interface MockMonth {
  bs_year: number;
  bs_month: number;
  /** AD date of day 1. */
  ad_start: string;
  days: number;
}

const MOCK_MONTHS: MockMonth[] = [
  { bs_year: 2083, bs_month: 6, ad_start: "2026-09-17", days: 30 },
  { bs_year: 2083, bs_month: 7, ad_start: "2026-10-17", days: 30 },
];

/** Saturday, unless settings.weekly_off says otherwise. */
export const MOCK_WEEKLY_OFF = 6;

const pad = (n: number) => String(n).padStart(2, "0");

export function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function parseIso(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(iso: string, days: number): string {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

/** Days between two ISO dates (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 86_400_000);
}

export function weekdayOf(iso: string): number {
  return parseIso(iso).getUTCDay();
}

export function monthKey(year: number, month: number): string {
  return `${year}-${pad(month)}`;
}

export function monthLabel(year: number, month: number): string {
  return `${BS_MONTHS_EN[month - 1]} ${year}`;
}

export function monthLabelNp(year: number, month: number): string {
  return `${BS_MONTHS_NP[month - 1]} ${toDevanagariDigits(year)}`;
}

export function buildMonth(
  spec: MockMonth,
  weeklyOff: number = MOCK_WEEKLY_OFF,
): BsMonthRef {
  const days: DayHeader[] = [];
  for (let i = 0; i < spec.days; i++) {
    const ad = addDays(spec.ad_start, i);
    const weekday = weekdayOf(ad);
    days.push({
      bs_date: `${spec.bs_year}-${pad(spec.bs_month)}-${pad(i + 1)}`,
      bs_day: i + 1,
      ad_date: ad,
      weekday,
      is_weekly_off: weekday === weeklyOff,
    });
  }
  return {
    bs_year: spec.bs_year,
    bs_month: spec.bs_month,
    label: monthLabel(spec.bs_year, spec.bs_month),
    label_np: monthLabelNp(spec.bs_year, spec.bs_month),
    key: monthKey(spec.bs_year, spec.bs_month),
    ad_start: spec.ad_start,
    ad_end: addDays(spec.ad_start, spec.days - 1),
    days,
    working_days: days.filter((d) => !d.is_weekly_off).length,
  };
}

export function listMonths(): MonthOption[] {
  return MOCK_MONTHS.map((m) => ({
    key: monthKey(m.bs_year, m.bs_month),
    label: monthLabel(m.bs_year, m.bs_month),
    label_np: monthLabelNp(m.bs_year, m.bs_month),
  }));
}

export function findMonth(key: string): BsMonthRef | null {
  const spec = MOCK_MONTHS.find((m) => monthKey(m.bs_year, m.bs_month) === key);
  return spec ? buildMonth(spec) : null;
}

/** Day header for a BS date inside the mock months; null when unknown. */
export function dayFromBs(bs: string): DayHeader | null {
  for (const spec of MOCK_MONTHS) {
    const month = buildMonth(spec);
    const day = month.days.find((d) => d.bs_date === bs);
    if (day) return day;
  }
  return null;
}

export function dayFromAd(ad: string): DayHeader | null {
  for (const spec of MOCK_MONTHS) {
    const offset = diffDays(spec.ad_start, ad);
    if (offset >= 0 && offset < spec.days) return buildMonth(spec).days[offset];
  }
  return null;
}

/** The design's "today" when the real date falls outside the mock months. */
const FALLBACK_TODAY_BS = "2083-07-04";

export function mockToday(now: Date = new Date()): TodayRef {
  const local = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const day = dayFromAd(local) ?? dayFromBs(FALLBACK_TODAY_BS)!;
  const [y, m, d] = day.bs_date.split("-").map(Number);
  return {
    bs_date: day.bs_date,
    ad_date: day.ad_date,
    weekday: day.weekday,
    bs_text: `${BS_MONTHS_EN[m - 1]} ${d}, ${y}`,
    np_text: `${WEEKDAY_NAMES_NP[day.weekday]}, ${BS_MONTHS_NP[m - 1]} ${toDevanagariDigits(d)}, ${toDevanagariDigits(y)}`,
  };
}
