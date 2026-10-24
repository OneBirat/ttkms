/** Text for BS and AD dates: strftime-style formats, Nepali digits, ranges, relative labels. */

import { addDays, diffDays, parseAd, weekdayOfAd } from "./ad";
import { adToBs, bsToAd, daysInMonth, isoBs, parseBs, validBs, type BsParts } from "./calendar";
import {
  AD_MONTHS_EN,
  AD_MONTHS_SHORT_EN,
  monthName,
  monthShort,
  weekdayName,
  weekdayShort,
  type Lang,
} from "./names";
import { todayAd } from "./time";

export { monthName, monthShort, weekdayName, weekdayShort, weekdayInitial } from "./names";
export type { Lang } from "./names";

const NE_DIGITS = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"];
const pad = (n: number) => String(n).padStart(2, "0");

/** 2083 -> "२०८३"; every ASCII digit is swapped, other characters are kept. */
export function toNepaliDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (d) => NE_DIGITS[Number(d)]);
}

/** Digits in the requested language. */
export function digits(value: string | number, lang: Lang): string {
  return lang === "ne" ? toNepaliDigits(value) : String(value);
}

const TOKEN_RE = /%(-?[YmdBbAa]|%)/g;

function render(
  fmt: string,
  parts: { year: number; month: number; day: number },
  names: { month: string; monthShort: string; weekday: () => number },
  lang: Lang,
): string {
  const text = fmt.replace(TOKEN_RE, (_, code: string) => {
    switch (code) {
      case "%": return "%";
      case "Y": return String(parts.year);
      case "m": return pad(parts.month);
      case "-m": return String(parts.month);
      case "d": return pad(parts.day);
      case "-d": return String(parts.day);
      case "B": return names.month;
      case "b": return names.monthShort;
      case "A": return weekdayName(names.weekday(), lang);
      default: return weekdayShort(names.weekday(), lang);
    }
  });
  return lang === "ne" ? toNepaliDigits(text) : text;
}

/**
 * strftime-style text for a BS date "YYYY-MM-DD": %Y year, %m/%-m month (padded/plain), %d/%-d
 * day, %B month name, %b short month, %A weekday, %a short weekday, %%. With lang "ne" the names
 * are Nepali and every digit Devanagari. formatBs("2083-07-07") -> "Kartik 7, 2083";
 * formatBs("2083-07-07", "%B %-d, %Y", "ne") -> "कार्तिक ७, २०८३". Unparsable input is returned as is.
 */
export function formatBs(bs: string | BsParts, fmt = "%B %-d, %Y", lang: Lang = "en"): string {
  const p = typeof bs === "string" ? parseBs(bs) : bs;
  if (!p) return String(bs);
  return render(fmt, p, {
    month: monthName(p.month, lang),
    monthShort: monthShort(p.month, lang),
    weekday: () => weekdayOfAd(bsToAd(p)),
  }, lang);
}

/** Same tokens for an AD date "YYYY-MM-DD": formatAd("2026-10-24") -> "24 Oct 2026". */
export function formatAd(ad: string, fmt = "%-d %b %Y", lang: Lang = "en"): string {
  const p = parseAd(ad);
  if (!p) return ad;
  return render(fmt, p, {
    month: AD_MONTHS_EN[p.month - 1],
    monthShort: AD_MONTHS_SHORT_EN[p.month - 1],
    weekday: () => weekdayOfAd(ad),
  }, lang);
}

/** "Kartik 7" / "कार्तिक ७" (no year). */
export function formatBsDay(bs: string, lang: Lang = "en"): string {
  return formatBs(bs, "%B %-d", lang);
}

/** "07-07" (month-day) for compact pills such as "Paid 07-02". */
export function formatBsShort(bs: string, lang: Lang = "en"): string {
  return formatBs(bs, "%m-%d", lang);
}

/** "Kartik 7, 2083 · 24 Oct 2026" – BS first, AD second. */
export function formatDateBoth(bs: string, lang: Lang = "en", ad: string = bsToAd(bs)): string {
  return `${formatBs(bs, "%B %-d, %Y", lang)} · ${formatAd(ad, "%-d %b %Y", lang)}`;
}

/** "24 Oct 2026" from an AD date; the year is dropped when `withYear` is false. */
export function formatAdShort(ad: string, withYear = true): string {
  return formatAd(ad, withYear ? "%-d %b %Y" : "%-d %b");
}

/** "17 Sep – 17 Oct 2026" (year shown once when it does not change). */
export function formatAdRange(start: string, end: string, lang: Lang = "en"): string {
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${formatAd(start, sameYear ? "%-d %b" : "%-d %b %Y", lang)} – ${formatAd(end, "%-d %b %Y", lang)}`;
}

/** "Ashwin 1 – Kartik 7, 2083" for a BS range (month and year shown once when shared). */
export function formatBsRange(from: string, to: string, lang: Lang = "en"): string {
  const a = parseBs(from);
  const b = parseBs(to);
  if (!a || !b) return `${from} – ${to}`;
  if (a.year === b.year && a.month === b.month) {
    return `${monthName(a.month, lang)} ${digits(a.day, lang)} – ${digits(b.day, lang)}, ${digits(a.year, lang)}`;
  }
  if (a.year === b.year) {
    return `${monthName(a.month, lang)} ${digits(a.day, lang)} – ${monthName(b.month, lang)} ${digits(b.day, lang)}, ${digits(a.year, lang)}`;
  }
  return `${formatBs(from, "%B %-d, %Y", lang)} – ${formatBs(to, "%B %-d, %Y", lang)}`;
}

/** "Kartik 1 – 30, 2083 · 18 Oct – 16 Nov 2026" */
export function formatMonthRange(year: number, month: number, lang: Lang = "en"): string {
  const length = daysInMonth(year, month);
  const start = bsToAd(isoBs(year, month, 1));
  const end = addDays(start, length - 1);
  return `${monthName(month, lang)} ${digits(1, lang)} – ${digits(length, lang)}, ${digits(year, lang)} · ${formatAdRange(start, end, lang)}`;
}

/** "Sat 24 Oct 2026" */
export function formatAdWeekday(ad: string, lang: Lang = "en"): string {
  return formatAd(ad, "%a %-d %b %Y", lang);
}

/**
 * "आज" / "हिजो" / "भोलि" / "३ दिन अघि" / "५ दिन पछि" (Today / Yesterday / Tomorrow / 3 days ago /
 * in 5 days) for an AD day, relative to today in Kathmandu; null when further than `maxDays`
 * away so the caller can show the date instead.
 */
export function relativeLabel(ad: string, lang: Lang = "en", now: Date | string | number = new Date(), maxDays = 30): string | null {
  const delta = diffDays(todayAd(now), ad);
  if (Math.abs(delta) > maxDays) return null;
  if (lang === "ne") {
    if (delta === 0) return "आज";
    if (delta === -1) return "हिजो";
    if (delta === 1) return "भोलि";
    return delta < 0 ? `${toNepaliDigits(-delta)} दिन अघि` : `${toNepaliDigits(delta)} दिन पछि`;
  }
  if (delta === 0) return "Today";
  if (delta === -1) return "Yesterday";
  if (delta === 1) return "Tomorrow";
  return delta < 0 ? `${-delta} days ago` : `in ${delta} days`;
}

/** The BS text of an AD day: "Kartik 7, 2083"; "" when outside the table. */
export function bsTextOfAd(ad: string, fmt = "%B %-d, %Y", lang: Lang = "en"): string {
  try {
    return formatBs(isoBs(adToBs(ad)), fmt, lang);
  } catch {
    return "";
  }
}

/** Both dates for a BS string: { bs, ad }; null when the date does not exist. */
export function dateBoth(bs: string): { bs: string; ad: string } | null {
  const p = validBs(bs);
  return p ? { bs: isoBs(p), ad: bsToAd(p) } : null;
}
