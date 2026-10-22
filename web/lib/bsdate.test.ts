// Run: cd web && node --experimental-strip-types --import ./components/stock/__tests__/register.mjs --test lib/bsdate.test.ts
// Backend parity: app/core/bsdate.py (table from scripts/port_bs_calendar.py) must give the same answers
// for KNOWN_PAIRS; main should add a pytest with identical values.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  adToBs,
  bsToAd,
  daysInBsMonth,
  formatAd,
  formatBs,
  formatBsIso,
  isValidBs,
  parseBs,
  todayAd,
  todayBs,
  toNepaliDigits,
  weekdayOf,
} from "./bsdate";

/**
 * [BS, AD] pairs checked against the official calendar (Nepal Panchanga
 * Nirnayak Samiti via hamropatro / nepalipatro / nakhatra):
 *   Baisakh 15, 2080 = 28 Apr 2023; Baisakh 1, 2081 = 13 Apr 2024;
 *   Kartik 1, 2083 = 18 Oct 2026, so Kartik 4, 2083 = 21 Oct 2026 (a Wednesday).
 *   (The design mock-ups said "Kartik 4 = Tue 20 Oct 2026"; that was one day off.)
 */
export const KNOWN_PAIRS: [string, string][] = [
  ["2080-01-15", "2023-04-28"],
  ["2081-01-01", "2024-04-13"],
  ["2083-07-01", "2026-10-18"],
  ["2083-07-04", "2026-10-21"],
  ["2082-01-01", "2025-04-14"],
  ["2083-01-01", "2026-04-14"],
];

test("known BS ↔ AD pairs", () => {
  for (const [bs, ad] of KNOWN_PAIRS) {
    assert.equal(bsToAd(bs), ad, `${bs} -> AD`);
    assert.equal(formatBsIso(adToBs(ad)!), bs, `${ad} -> BS`);
  }
  assert.equal(weekdayOf("2026-10-21"), 3, "Kartik 4, 2083 is a Wednesday");
});

test("round trip for the first and last day of every month in 2082–2084", () => {
  for (const year of [2082, 2083, 2084]) {
    for (let month = 1; month <= 12; month++) {
      const days = daysInBsMonth(year, month);
      assert.ok(days !== null && days >= 29 && days <= 32, `${year}-${month} has ${days} days`);
      for (const day of [1, days]) {
        const bs = formatBsIso({ year, month, day });
        const ad = bsToAd(bs);
        assert.ok(ad, bs);
        assert.equal(formatBsIso(adToBs(ad)!), bs, `${bs} -> ${ad} -> BS`);
      }
      // The day after the last day is the 1st of the next month.
      const next = adToBs(addDays(bsToAd({ year, month, day: days })!, 1))!;
      assert.deepEqual(next, month === 12 ? { year: year + 1, month: 1, day: 1 } : { year, month: month + 1, day: 1 });
    }
  }
});

test("invalid or out-of-range input returns null instead of throwing", () => {
  assert.equal(bsToAd("2083-13-01"), null);
  assert.equal(bsToAd("2083-07-31"), null, "Kartik 2083 has 30 days");
  assert.equal(bsToAd("2083-07-00"), null);
  assert.equal(bsToAd("1900-01-01"), null);
  assert.equal(bsToAd("2100-01-01"), null);
  assert.equal(bsToAd("nope"), null);
  assert.equal(adToBs("1900-01-01"), null);
  assert.equal(adToBs("2026-02-30"), null);
  assert.equal(adToBs("2026-10-2"), null);
  assert.equal(isValidBs("2083-07-30"), true);
  assert.equal(isValidBs("2083-07-31"), false);
  assert.deepEqual(parseBs("2083-7-4"), { year: 2083, month: 7, day: 4 });
  assert.equal(parseBs("2083-07"), null);
});

test("formatting in Nepali and English", () => {
  assert.equal(formatBs("2083-07-04"), "Kartik 4, 2083");
  assert.equal(formatBs("2083-07-04", { lang: "en", weekday: true }), "Wednesday, Kartik 4, 2083");
  assert.equal(formatBs("2083-07-04", { lang: "ne" }), "कार्तिक ४, २०८३");
  assert.equal(formatBs("2083-07-04", { lang: "ne", weekday: true }), "बुधबार, कार्तिक ४, २०८३");
  assert.equal(formatBs("2083-07-03", { lang: "ne", weekday: true }), "मंगलबार, कार्तिक ३, २०८३");
  assert.equal(formatBs({ year: 2081, month: 1, day: 1 }), "Baisakh 1, 2081");
  assert.equal(formatBs("garbage"), "garbage");
  assert.equal(toNepaliDigits(2083), "२०८३");
  assert.equal(toNepaliDigits("2083-07-04"), "२०८३-०७-०४");
  assert.equal(formatAd("2026-10-20"), "Tuesday, 20 October 2026");
  assert.equal(formatAd("2026-10-21"), "Wednesday, 21 October 2026");
});

test("today follows Asia/Kathmandu, not UTC", () => {
  // 2026-10-20 18:30 UTC is already 00:15 on 21 Oct in Kathmandu (UTC+5:45).
  assert.equal(todayAd(new Date(Date.UTC(2026, 9, 20, 18, 30))), "2026-10-21");
  assert.equal(todayAd(new Date(Date.UTC(2026, 9, 20, 18, 0))), "2026-10-20");
  assert.equal(todayBs(new Date(Date.UTC(2026, 9, 20, 18, 30))), "2083-07-04");
  assert.match(todayBs(), /^20\d\d-\d\d-\d\d$/);
});
