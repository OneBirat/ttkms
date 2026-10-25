/**
 * Phone Attendance report (design/report-mobile/AttendanceReportMobile.dc.html): the period it
 * shows (Month / Week / Day inside a BS month), its ‹ › navigation, the URL state and the look
 * of each day cell. Pure functions over web/lib/bs, so the node tests cover them.
 */

import {
  WEEKDAYS_EN,
  daysInMonth,
  formatAdRange,
  formatAdShort,
  monthLabel,
  monthName,
  parseMonthKey,
  shiftMonth,
  monthKey as toMonthKey,
} from "@/lib/bs";
import { bsMonthDays } from "./calendar";
import { sliceWeeks } from "./helpers";
import type { DayCell, DayHeader, WeekGrid } from "./types";

export type MobileView = "month" | "week" | "day";

export const MOBILE_VIEWS: { key: MobileView; label: string }[] = [
  { key: "month", label: "Month" },
  { key: "week", label: "Week" },
  { key: "day", label: "Day" },
];

/** What the screen shows: a BS month, and inside it a week (1-based) and a day (BS day). */
export interface Period {
  view: MobileView;
  /** "2083-07" */
  month: string;
  week: number;
  day: number;
}

/** How far ‹ › may go: the months the report offers (oldest first) and today (BS). */
export interface PeriodBounds {
  months: readonly string[];
  /** "2083-07-08" */
  today: string;
}

function parts(key: string): { year: number; month: number } {
  const p = parseMonthKey(key);
  if (!p) throw new Error(`Bad month ${key}`);
  return p;
}

/** Sun–Sat weeks of a BS month (the first and last may be short). */
export function weeksOf(key: string): WeekGrid[] {
  const { year, month } = parts(key);
  return sliceWeeks(bsMonthDays(year, month), monthName(month));
}

/** The last day of the month that is not in the future (today in the current month). */
export function lastPastDay(key: string, today: string): number {
  const { year, month } = parts(key);
  if (today.slice(0, 7) === key) return Number(today.slice(8, 10));
  return daysInMonth(year, month);
}

function weekOfDay(key: string, day: number): number {
  return weeksOf(key).find((w) => w.days.some((d) => d.bs_day === day))?.index ?? 1;
}

/** The month's latest past day and its week: where ‹ lands, and the default. */
function monthEnd(key: string, today: string): Pick<Period, "week" | "day"> {
  const day = lastPastDay(key, today);
  return { day, week: weekOfDay(key, day) };
}

function inBounds(key: string, bounds: PeriodBounds): boolean {
  return bounds.months.includes(key) && key <= bounds.today.slice(0, 7);
}

/** The period shown when the URL says nothing: this month, this week, today. */
export function defaultPeriod(bounds: PeriodBounds): Period {
  const month = bounds.today.slice(0, 7);
  return { view: "month", month, ...monthEnd(month, bounds.today) };
}

/** Pulls a period back inside the bounds: no future month, week or day. */
export function clampPeriod(period: Period, bounds: PeriodBounds): Period {
  if (!inBounds(period.month, bounds)) return { ...defaultPeriod(bounds), view: period.view };
  const last = lastPastDay(period.month, bounds.today);
  const day = Math.min(Math.max(1, Math.trunc(period.day) || last), last);
  const maxWeek = weekOfDay(period.month, last);
  const week = Math.min(Math.max(1, Math.trunc(period.week) || maxWeek), maxWeek);
  return { ...period, day, week };
}

/** ‹ (-1) or › (+1) in the current view; null when that would leave the bounds. */
export function stepPeriod(period: Period, dir: -1 | 1, bounds: PeriodBounds): Period | null {
  const { month, view } = period;
  const neighbour = () => {
    const { year, month: m } = parts(month);
    const next = shiftMonth(year, m, dir);
    const key = toMonthKey(next.year, next.month);
    return inBounds(key, bounds) ? key : null;
  };
  const toMonth = (key: string | null, at: "start" | "end"): Period | null => {
    if (!key) return null;
    return { view, month: key, ...(at === "end" ? monthEnd(key, bounds.today) : { week: 1, day: 1 }) };
  };
  if (view === "month") return toMonth(neighbour(), "end");
  const last = lastPastDay(month, bounds.today);
  if (view === "week") {
    const target = period.week + dir;
    if (target >= 1 && target <= weekOfDay(month, last)) {
      const first = weeksOf(month)[target - 1].days[0].bs_day;
      return { ...period, week: target, day: dir < 0 ? first : Math.min(first, last) };
    }
    return toMonth(neighbour(), dir < 0 ? "end" : "start");
  }
  const target = period.day + dir;
  if (target >= 1 && target <= last) return { ...period, day: target, week: weekOfDay(month, target) };
  return toMonth(neighbour(), dir < 0 ? "end" : "start");
}

// ------------------------------------------------------------ URL

const VIEWS = new Set<MobileView>(["month", "week", "day"]);

/** ?view=&bs_year=&bs_month=&week=&day= → a period inside the bounds. */
export function periodFromParams(params: URLSearchParams, bounds: PeriodBounds): Period {
  const fallback = defaultPeriod(bounds);
  const view = (VIEWS.has(params.get("view") as MobileView) ? params.get("view") : "month") as MobileView;
  const y = Number(params.get("bs_year"));
  const m = Number(params.get("bs_month"));
  const month = Number.isInteger(y) && Number.isInteger(m) && m >= 1 && m <= 12 && y > 1900 ? toMonthKey(y, m) : fallback.month;
  const end = inBounds(month, bounds) ? monthEnd(month, bounds.today) : fallback;
  const week = Number(params.get("week")) || end.week;
  const day = Number(params.get("day")) || end.day;
  return clampPeriod({ view, month, week, day }, bounds);
}

/** The URL keys of a period (the rest of the query string is left alone). */
export function periodParams(period: Period): Record<"view" | "bs_year" | "bs_month" | "week" | "day", string> {
  const { year, month } = parts(period.month);
  return {
    view: period.view,
    bs_year: String(year),
    bs_month: String(month),
    week: String(period.week),
    day: String(period.day),
  };
}

// ------------------------------------------------------------ titles

export interface PeriodTitle {
  title: string;
  sub: string;
}

/** Header lines: "Kartik 2083" / "Week 2 · Kartik 8–14" / "Kartik 8, 2083 · आज", with the AD under it. */
export function periodTitle(period: Period, today: string): PeriodTitle {
  const { year, month } = parts(period.month);
  const days = bsMonthDays(year, month);
  const name = monthName(month);
  if (period.view === "month") {
    const sub = `${monthLabel(year, month, "ne")} · ${formatAdRange(days[0].ad_date, days[days.length - 1].ad_date)}`;
    return { title: monthLabel(year, month), sub };
  }
  if (period.view === "week") {
    const week = weeksOf(period.month)[period.week - 1] ?? weeksOf(period.month)[0];
    const first = week.days[0];
    const last = week.days[week.days.length - 1];
    const range = first.bs_day === last.bs_day ? `${first.bs_day}` : `${first.bs_day}–${last.bs_day}`;
    return { title: `Week ${week.index} · ${name} ${range}`, sub: formatAdRange(first.ad_date, last.ad_date) };
  }
  const day = days[period.day - 1] ?? days[0];
  const isToday = day.bs_date === today;
  return {
    title: `${name} ${day.bs_day}, ${year}${isToday ? " · आज" : ""}`,
    sub: `${formatAdShort(day.ad_date)} · ${WEEKDAYS_EN[day.weekday]}`,
  };
}

/** Indices into month.days of the days in view (Week: that week; Day: that day). */
export function periodIndices(period: Period): number[] {
  if (period.view === "day") return [period.day - 1];
  if (period.view === "week") {
    const week = weeksOf(period.month)[period.week - 1];
    return week ? week.days.map((_, i) => week.offset + i) : [];
  }
  const { year, month } = parts(period.month);
  return Array.from({ length: daysInMonth(year, month) }, (_, i) => i);
}

// ------------------------------------------------------------ cells

/** What a day cell looks like: a mark, Saturday, not marked yet, or a future day. */
export type CellLook = "P" | "O" | "A" | "W" | "N" | "F";

export function cellLook(cell: DayCell | undefined, day: DayHeader, today: string): CellLook {
  if (day.bs_date > today) return "F";
  return cell?.status ?? (day.is_weekly_off ? "W" : "N");
}

/** Solid colours of the month strip and the legend. */
export const STRIP_COLOUR: Record<CellLook, string> = {
  P: "#1E9E4A",
  O: "#E0A800",
  A: "#C0392B",
  W: "#D5D9D5",
  N: "#FFFFFF",
  F: "#FFFFFF",
};

/** Outline of a strip block: red for not marked, grey for future, none otherwise. */
export const STRIP_OUTLINE: Record<CellLook, string | null> = {
  P: null,
  O: null,
  A: null,
  W: null,
  N: "#C0392B",
  F: "#E2E5E1",
};

/** Pale background / text of calendar, week and day cells. */
export const PALE_COLOUR: Record<CellLook, { bg: string; fg: string }> = {
  P: { bg: "#E6F5F3", fg: "#0A5454" },
  O: { bg: "#FFF4CC", fg: "#7A5600" },
  A: { bg: "#FBE9E4", fg: "#8E2F12" },
  W: { bg: "#F4F5F2", fg: "#B42318" },
  N: { bg: "#FFFFFF", fg: "#8E2F12" },
  F: { bg: "#FFFFFF", fg: "#B5BEB9" },
};

/** Calendar cell mark: P / "O 2h" / A / W / "–" (not marked) / "" (future). */
export function calendarMark(look: CellLook, otHours: number): string {
  if (look === "O") return `O ${otHours}h`;
  if (look === "N") return "–";
  if (look === "F") return "";
  return look;
}

/** Week box text: P / "2h" / A / W / "–" / "" (future). */
export function weekMark(look: CellLook, otHours: number): string {
  if (look === "O") return `${otHours}h`;
  return calendarMark(look, otHours);
}

/** Day view status pill text. */
export function dayPillText(look: CellLook, otHours: number): string {
  switch (look) {
    case "P":
      return "Present";
    case "O":
      return `Overtime · ${otHours} h`;
    case "A":
      return "Absent";
    case "W":
      return "Saturday";
    case "N":
      return "Not marked";
    default:
      return "—";
  }
}

/** "9:14 am" in Kathmandu from wall-clock hours / minutes. */
export function clockText(hour: number, minute: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`;
}
