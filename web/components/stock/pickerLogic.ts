/**
 * Pure helpers behind the Nepali date & time picker (BsDatePicker.tsx).
 * Tested in __tests__/picker.test.mjs.
 */

import {
  adToBs,
  BS_MAX_YEAR,
  BS_MIN_YEAR,
  BS_MONTHS_EN,
  BS_MONTHS_NP,
  bsToAd,
  daysInBsMonth,
  formatBsIso,
  parseBs,
  SATURDAY,
  toNepaliDigits,
  weekdayOf,
  type BsDate,
} from "@/lib/bsdate";

export interface PickerCell {
  bs: string;
  ad: string;
  day: number;
  /** Day in Devanagari digits. */
  dayNp: string;
  /** AD day of month, shown small under the BS day. */
  adDay: number;
  weekday: number;
  saturday: boolean;
}

export interface PickerMonth {
  year: number;
  month: number;
  /** "कार्तिक २०८३" */
  titleNp: string;
  /** "Kartik 2083" */
  titleEn: string;
  /** 7 cells per week, null before the 1st and after the last day. */
  weeks: (PickerCell | null)[][];
  canGoPrev: boolean;
  canGoNext: boolean;
}

/** The month to open the picker on: the field's date when valid, otherwise today's. */
export function initialMonth(value: string, todayBs: string): { year: number; month: number } {
  const parts = parseBs(value) ?? parseBs(todayBs);
  if (!parts) throw new RangeError("no usable BS date");
  return { year: parts.year, month: parts.month };
}

export function shiftMonth(year: number, month: number, delta: 1 | -1): { year: number; month: number } {
  if (delta === 1) return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/** Builds the calendar grid of one BS month; throws outside the converter's table. */
export function monthGrid(year: number, month: number): PickerMonth {
  const days = daysInBsMonth(year, month);
  if (days === null) throw new RangeError(`BS ${year}-${month} is outside the calendar table`);
  const weeks: (PickerCell | null)[][] = [];
  let week: (PickerCell | null)[] = [];
  const firstAd = bsToAd({ year, month, day: 1 }) as string;
  for (let i = 0; i < weekdayOf(firstAd); i++) week.push(null);
  for (let day = 1; day <= days; day++) {
    const d: BsDate = { year, month, day };
    const ad = bsToAd(d) as string;
    const weekday = weekdayOf(ad);
    week.push({
      bs: formatBsIso(d),
      ad,
      day,
      dayNp: toNepaliDigits(day),
      adDay: Number(ad.slice(8, 10)),
      weekday,
      saturday: weekday === SATURDAY,
    });
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  return {
    year,
    month,
    titleNp: `${BS_MONTHS_NP[month - 1]} ${toNepaliDigits(year)}`,
    titleEn: `${BS_MONTHS_EN[month - 1]} ${year}`,
    weeks,
    canGoPrev: prev.year >= BS_MIN_YEAR,
    canGoNext: next.year <= BS_MAX_YEAR,
  };
}

/** "HH:MM" (24 h) in Asia/Kathmandu for the shop's clock. */
export function nowTimeKathmandu(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kathmandu",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${hour}:${get("minute")}`;
}

/** True for "HH:MM" with a valid hour and minute. */
export function isValidTime(value: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  return !!m && Number(m[1]) < 24 && Number(m[2]) < 60;
}

/** Today's BS date from an AD date, or null outside the table. */
export function bsOfAd(ad: string): string | null {
  const bs = adToBs(ad);
  return bs ? formatBsIso(bs) : null;
}
