/**
 * AD calendar-day arithmetic on "YYYY-MM-DD" strings. Days are handled as UTC calendar days so
 * the browser's time zone can never shift a date; nothing here knows about clocks.
 */

const AD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, "0");

export interface AdParts {
  year: number;
  month: number;
  day: number;
}

export function parseAd(ad: string): AdParts | null {
  const m = AD_RE.exec(ad);
  if (!m) return null;
  const parts = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  return isoAd(adToDate(parts)) === ad ? parts : null;
}

/** "YYYY-MM-DD" from parts. */
export function isoAdParts(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The UTC calendar day of a Date as "YYYY-MM-DD". */
export function isoAd(d: Date): string {
  return isoAdParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function adToDate(parts: AdParts): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

/** Midnight UTC of the day, as a Date (for arithmetic only). */
export function adDate(ad: string): Date {
  const [y, m, d] = ad.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`Not an AD date: ${ad}`);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(ad: string, days: number): string {
  const d = adDate(ad);
  d.setUTCDate(d.getUTCDate() + days);
  return isoAd(d);
}

/** Days from `a` to `b` (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((adDate(b).getTime() - adDate(a).getTime()) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOfAd(ad: string): number {
  return adDate(ad).getUTCDay();
}

/** ISO-shaped dates (AD or BS) compare as text: negative when a is before b. */
export function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
