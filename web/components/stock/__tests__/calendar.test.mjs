import { test } from "node:test";
import assert from "node:assert/strict";
import { adToBs, bsToAd, addDays, weekdayOf, daysInBsMonth, parseBsIso, formatBsIso, formatBsLongNp, formatBsLong } from "../calendar.ts";

test("Kartik 4, 2083 is Wednesday 21 Oct 2026 (official calendar; the design mock-up was a day off)", () => {
  assert.equal(bsToAd({ year: 2083, month: 7, day: 4 }), "2026-10-21");
  assert.deepEqual(adToBs("2026-10-21"), { year: 2083, month: 7, day: 4 });
  assert.equal(weekdayOf("2026-10-21"), 3);
});

test("round trip through every day of 2082 and 2083", () => {
  let ad = bsToAd({ year: 2082, month: 1, day: 1 });
  for (const year of [2082, 2083]) {
    for (let month = 1; month <= 12; month++) {
      for (let day = 1; day <= daysInBsMonth(year, month); day++) {
        assert.deepEqual(adToBs(ad), { year, month, day }, ad);
        assert.equal(bsToAd({ year, month, day }), ad);
        ad = addDays(ad, 1);
      }
    }
  }
  assert.equal(ad, bsToAd({ year: 2084, month: 1, day: 1 }));
});

test("parseBsIso validates ranges and real days", () => {
  assert.deepEqual(parseBsIso("2083-07-04"), { year: 2083, month: 7, day: 4 });
  assert.equal(parseBsIso("2083-13-01"), null);
  assert.equal(parseBsIso("2083-07-31"), null);
  assert.equal(parseBsIso("1900-01-01"), null);
  assert.equal(parseBsIso("nope"), null);
  assert.equal(formatBsIso({ year: 2083, month: 7, day: 4 }), "2083-07-04");
  assert.throws(() => bsToAd({ year: 2083, month: 7, day: 31 }), RangeError);
  assert.throws(() => adToBs("1900-01-01"), RangeError);
});

test("formatting", () => {
  assert.equal(formatBsLongNp({ year: 2083, month: 7, day: 4 }), "कार्तिक ४, २०८३");
  assert.equal(formatBsLong({ year: 2083, month: 7, day: 4 }), "Kartik 4, 2083");
});
