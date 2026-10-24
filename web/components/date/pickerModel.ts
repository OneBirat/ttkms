/** Pure calendar-grid logic for <BSDatePicker>, tested on its own. */

import {
  adToBs,
  bsToAd,
  compareIso,
  daysInMonth,
  isoBs,
  monthDays,
  parseBs,
  shiftMonth,
  todayAd,
  validBs,
  yearRange,
  type BsMonth,
  type BsParts,
  type MonthDay,
} from "@/lib/bs";

export interface PickerLimits {
  /** BS "YYYY-MM-DD", inclusive. */
  min?: string | null;
  max?: string | null;
  /** Days after today (Kathmandu) cannot be picked. */
  noFutureDays?: boolean;
}

export interface GridCell extends MonthDay {
  disabled: boolean;
  isToday: boolean;
  isSaturday: boolean;
}

/** Today (BS) in Kathmandu as parts and ISO. */
export function todayParts(now?: Date | string | number): { bs: string; parts: BsParts; ad: string } {
  const ad = todayAd(now);
  const parts = adToBs(ad);
  return { bs: isoBs(parts), parts, ad };
}

/** The effective BS bounds, as ISO strings, from limits and the table range. */
export function effectiveBounds(limits: PickerLimits, today: string): { min: string; max: string } {
  const [lo, hi] = yearRange();
  let min = isoBs(lo, 1, 1);
  let max = isoBs(hi, 12, daysInMonth(hi, 12));
  if (limits.min && validBs(limits.min) && compareIso(limits.min, min) > 0) min = limits.min;
  if (limits.max && validBs(limits.max) && compareIso(limits.max, max) < 0) max = limits.max;
  if (limits.noFutureDays && compareIso(today, max) < 0) max = today;
  return { min, max };
}

export function isPickable(bs: string, bounds: { min: string; max: string }): boolean {
  return compareIso(bs, bounds.min) >= 0 && compareIso(bs, bounds.max) <= 0;
}

/** Can the view move to this month (does any of its days lie inside the bounds)? */
export function monthInBounds(month: BsMonth, bounds: { min: string; max: string }): boolean {
  const first = isoBs(month.year, month.month, 1);
  const last = isoBs(month.year, month.month, daysInMonth(month.year, month.month));
  return compareIso(last, bounds.min) >= 0 && compareIso(first, bounds.max) <= 0;
}

/** The cells of a month plus the number of blank cells before day 1 (grid starts on Sunday). */
export function monthGrid(
  month: BsMonth,
  bounds: { min: string; max: string },
  today: string,
): { lead: number; cells: GridCell[] } {
  const days = monthDays(month.year, month.month);
  return {
    lead: days[0]?.weekday ?? 0,
    cells: days.map((d) => ({
      ...d,
      disabled: !isPickable(d.bs, bounds),
      isToday: d.bs === today,
      isSaturday: d.weekday === 6,
    })),
  };
}

/** Which month the picker opens on: the value, else today, clamped into the bounds. */
export function initialMonth(value: string | null | undefined, today: BsParts, bounds: { min: string; max: string }): BsMonth {
  const v = value ? validBs(value) : null;
  const month = v ? { year: v.year, month: v.month } : { year: today.year, month: today.month };
  if (monthInBounds(month, bounds)) return month;
  const edge = parseBs(compareIso(isoBs(month.year, month.month, 1), bounds.min) < 0 ? bounds.min : bounds.max)!;
  return { year: edge.year, month: edge.month };
}

/** Move a BS date by days / weeks / months for keyboard navigation, staying inside the table. */
export function moveDate(bs: string, unit: "day" | "week" | "month" | "year", delta: number): string {
  const p = validBs(bs);
  if (!p) return bs;
  try {
    if (unit === "day" || unit === "week") {
      const ad = bsToAd(p);
      const d = new Date(`${ad}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + delta * (unit === "week" ? 7 : 1));
      return isoBs(adToBs(d.toISOString().slice(0, 10)));
    }
    const m = shiftMonth(p.year, p.month, unit === "month" ? delta : delta * 12);
    return isoBs(m.year, m.month, Math.min(p.day, daysInMonth(m.year, m.month)));
  } catch {
    return bs;
  }
}

/** First / last day of the week (Sunday … Saturday) containing the date. */
export function weekEdge(bs: string, edge: "start" | "end"): string {
  const p = validBs(bs);
  if (!p) return bs;
  const weekday = monthDays(p.year, p.month)[p.day - 1].weekday;
  return moveDate(bs, "day", edge === "start" ? -weekday : 6 - weekday);
}

/** Year options for the year select: the table's range, or min..max when both are set. */
export function yearOptions(bounds: { min: string; max: string }): number[] {
  const lo = parseBs(bounds.min)!.year;
  const hi = parseBs(bounds.max)!.year;
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}
