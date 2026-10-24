/** Date-range presets shared by the range picker and the registers. Ranges are BS strings. */

import { addDaysBs, daysInMonth, isoBs } from "./calendar";
import { shiftMonth } from "./months";
import { nowInKathmandu } from "./time";
import type { Lang } from "./names";

export type RangePreset = "this_month" | "last_month" | "last_30" | "last_3";

export interface BsRange {
  /** BS "YYYY-MM-DD", inclusive. */
  from: string;
  to: string;
}

export const RANGE_PRESETS: { value: RangePreset; label: string; label_ne: string }[] = [
  { value: "this_month", label: "This month", label_ne: "यो महिना" },
  { value: "last_month", label: "Last month", label_ne: "गत महिना" },
  { value: "last_30", label: "Last 30 days", label_ne: "पछिल्लो ३० दिन" },
  { value: "last_3", label: "Last 3 months", label_ne: "पछिल्लो ३ महिना" },
];

export function presetLabel(preset: RangePreset, lang: Lang = "en"): string {
  const p = RANGE_PRESETS.find((x) => x.value === preset)!;
  return lang === "ne" ? p.label_ne : p.label;
}

/** The presets, all inclusive and ending today in Kathmandu (last month: its last day). */
export function rangeFor(preset: RangePreset, now: Date | string | number = new Date()): BsRange {
  const today = nowInKathmandu(now);
  const { year, month } = today.bsParts;
  switch (preset) {
    case "this_month":
      return { from: isoBs(year, month, 1), to: today.bs };
    case "last_month": {
      const p = shiftMonth(year, month, -1);
      return { from: isoBs(p.year, p.month, 1), to: isoBs(p.year, p.month, daysInMonth(p.year, p.month)) };
    }
    case "last_30":
      return { from: addDaysBs(today.bs, -29), to: today.bs };
    case "last_3": {
      const p = shiftMonth(year, month, -2);
      return { from: isoBs(p.year, p.month, 1), to: today.bs };
    }
  }
}

/** Which preset a range equals today, if any. */
export function presetOf(range: BsRange, now: Date | string | number = new Date()): RangePreset | null {
  for (const preset of RANGE_PRESETS) {
    const r = rangeFor(preset.value, now);
    if (r.from === range.from && r.to === range.to) return preset.value;
  }
  return null;
}
