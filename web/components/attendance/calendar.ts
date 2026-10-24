/**
 * Calendar objects for the attendance screens, built on the shared BS library (web/lib/bs):
 * today, BS months with their day headers, the month options of the report select. Nothing here
 * is mock data; the backend produces the same shapes from app/core/bsdate.py.
 */

import {
  addDays,
  adToBs,
  bsToAd,
  formatAdShort,
  formatBs,
  isoBs,
  monthDays,
  monthKey,
  monthLabel,
  parseMonthKey,
  shiftMonth,
  todayAd,
  validBs,
  weekdayOfAd,
  type MonthDay,
} from "@/lib/bs";
import type { BsMonthRef, DayHeader, MonthOption, TodayRef } from "./types";

/** Saturday, unless settings.weekly_off says otherwise. */
export const DEFAULT_WEEKLY_OFF = 6;

/** How many months back the report select offers (current month included). */
export const MONTHS_OFFERED = 3;

function header(d: MonthDay, weeklyOff: number): DayHeader {
  return { bs_date: d.bs, bs_day: d.day, ad_date: d.ad, weekday: d.weekday, is_weekly_off: d.weekday === weeklyOff };
}

/** Day headers of a BS month (weekly off marked). */
export function bsMonthDays(year: number, month: number, weeklyOff = DEFAULT_WEEKLY_OFF): DayHeader[] {
  return monthDays(year, month).map((d) => header(d, weeklyOff));
}

export function buildMonth(year: number, month: number, weeklyOff = DEFAULT_WEEKLY_OFF): BsMonthRef {
  const days = bsMonthDays(year, month, weeklyOff);
  return {
    bs_year: year,
    bs_month: month,
    label: monthLabel(year, month),
    label_np: monthLabel(year, month, "ne"),
    key: monthKey(year, month),
    ad_start: days[0].ad_date,
    ad_end: days[days.length - 1].ad_date,
    days,
    working_days: days.filter((d) => !d.is_weekly_off).length,
  };
}

export function findMonth(key: string, weeklyOff = DEFAULT_WEEKLY_OFF): BsMonthRef | null {
  const parsed = parseMonthKey(key);
  if (!parsed) return null;
  try {
    return buildMonth(parsed.year, parsed.month, weeklyOff);
  } catch {
    return null;
  }
}

/** The current month and the previous ones, oldest first. */
export function listMonths(now: Date = new Date()): MonthOption[] {
  const today = adToBs(todayAd(now));
  const options: MonthOption[] = [];
  for (let back = MONTHS_OFFERED - 1; back >= 0; back--) {
    const { year, month } = shiftMonth(today.year, today.month, -back);
    options.push({ key: monthKey(year, month), label: monthLabel(year, month), label_np: monthLabel(year, month, "ne") });
  }
  return options;
}

/** Day header for one BS date; null when the date does not exist. */
export function dayFromBs(bs: string, weeklyOff = DEFAULT_WEEKLY_OFF): DayHeader | null {
  const p = validBs(bs);
  if (!p) return null;
  const ad = bsToAd(p);
  const weekday = weekdayOfAd(ad);
  return { bs_date: isoBs(p), bs_day: p.day, ad_date: ad, weekday, is_weekly_off: weekday === weeklyOff };
}

export function dayFromAd(ad: string, weeklyOff = DEFAULT_WEEKLY_OFF): DayHeader {
  const p = adToBs(ad);
  const weekday = weekdayOfAd(ad);
  return { bs_date: isoBs(p), bs_day: p.day, ad_date: ad, weekday, is_weekly_off: weekday === weeklyOff };
}

/** Today in Kathmandu, BS first (GET /api/today gives the same from the server). */
export function todayRef(now: Date = new Date()): TodayRef {
  const ad = todayAd(now);
  const day = dayFromAd(ad);
  return {
    bs_date: day.bs_date,
    ad_date: ad,
    weekday: day.weekday,
    bs_text: formatBs(day.bs_date),
    np_text: formatBs(day.bs_date, "%A, %B %-d", "ne"),
    ad_text: formatAdShort(ad, true),
  };
}

/** Day headers from `start` (AD) for `count` days – used by the mock seed. */
export function daysFrom(start: string, count: number): DayHeader[] {
  return Array.from({ length: count }, (_, i) => dayFromAd(addDays(start, i)));
}
