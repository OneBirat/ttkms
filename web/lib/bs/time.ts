/**
 * Nepal time. The business time zone is Asia/Kathmandu (UTC+05:45); "today" and day boundaries
 * are always computed there, never in the browser's local time. Timestamps travel as ISO strings
 * in UTC (what the API sends); calendar days as "YYYY-MM-DD".
 */

import { isoAdParts, weekdayOfAd } from "./ad";
import { adToBs, isoBs, type BsParts } from "./calendar";

export const TIMEZONE = "Asia/Kathmandu";
/** Nepal has no daylight saving: a fixed +05:45. */
export const KATHMANDU_OFFSET_MINUTES = 5 * 60 + 45;

export interface KathmanduClock {
  /** AD day "YYYY-MM-DD". */
  ad: string;
  /** BS day "YYYY-MM-DD". */
  bs: string;
  bsParts: BsParts;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(instant: Date): { ad: string; hour: number; minute: number; second: number } {
  // A fixed offset, so no Intl lookups: shift the instant and read it as UTC.
  const shifted = new Date(instant.getTime() + KATHMANDU_OFFSET_MINUTES * 60_000);
  return {
    ad: isoAdParts(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate()),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

function asDate(value: Date | string | number): Date {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`Not a timestamp: ${String(value)}`);
  return d;
}

/** The current (or given) instant as a Kathmandu wall clock, both calendars. */
export function nowInKathmandu(now: Date | string | number = new Date()): KathmanduClock {
  const clock = wallClock(asDate(now));
  const bsParts = adToBs(clock.ad);
  return { ...clock, bs: isoBs(bsParts), bsParts, weekday: weekdayOfAd(clock.ad) };
}

/** Today's AD date in Kathmandu as "YYYY-MM-DD". */
export function todayAd(now: Date | string | number = new Date()): string {
  return wallClock(asDate(now)).ad;
}

/** Today's BS date in Kathmandu as "YYYY-MM-DD". */
export function todayBs(now: Date | string | number = new Date()): string {
  return isoBs(adToBs(todayAd(now)));
}

/** The Kathmandu calendar day (AD) a timestamp falls on. */
export function kathmanduDate(timestamp: Date | string | number): string {
  return wallClock(asDate(timestamp)).ad;
}

/** The Kathmandu calendar day (BS) a timestamp falls on. */
export function kathmanduDateBs(timestamp: Date | string | number): string {
  return isoBs(adToBs(kathmanduDate(timestamp)));
}

/** Kathmandu wall-clock time of a timestamp. */
export function kathmanduTime(timestamp: Date | string | number): { hour: number; minute: number; second: number } {
  const { hour, minute, second } = wallClock(asDate(timestamp));
  return { hour, minute, second };
}

/** The UTC instant (ISO string) of a Kathmandu wall-clock time on an AD day. */
export function instantOf(ad: string, hour: number, minute: number, second = 0): string {
  const [y, m, d] = ad.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d, hour, minute, second) - KATHMANDU_OFFSET_MINUTES * 60_000;
  return new Date(utc).toISOString();
}

/** `[start, end)` of a Kathmandu calendar day as UTC ISO strings. */
export function dayBounds(ad: string): { start: string; end: string } {
  const start = instantOf(ad, 0, 0);
  return { start, end: new Date(new Date(start).getTime() + 86_400_000).toISOString() };
}
