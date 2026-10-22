/** Display helpers: BS first, AD secondary. */

import { formatBs, toDevanagariDigits } from "@/lib/bsdate";

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Kathmandu",
});

const adFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Kathmandu",
});

/** "09:14" in Nepal time from an ISO timestamp. */
export function timeOf(iso: string): string {
  return timeFormat.format(new Date(iso));
}

/** "2083-07-06 · 09:14" (BS date + time). */
export function bsDateTime(bs: string, iso: string, nepaliDigits = false): string {
  const date = nepaliDigits ? toDevanagariDigits(bs) : bs;
  return `${date} · ${timeOf(iso)}`;
}

/** "Kartik 6, 2083" for a BS "YYYY-MM-DD". */
export function bsLong(bs: string): string {
  return formatBs(bs);
}

/** "23 Oct 2026, 09:14" - the AD form shown on hover / as secondary text. */
export function adDateTime(iso: string): string {
  return adFormat.format(new Date(iso));
}

/** AD date only, "23 Oct 2026". */
export function adDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kathmandu",
  }).format(new Date(iso));
}
