import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adToBs,
  bsToAd,
  addDays,
  weekdayOf,
  daysInBsMonth,
  parseBsIso,
  formatBsIso,
  formatBsLongNp,
} from "../calendar.ts";

test("design anchor: Kartik 4, 2083 is 20 Oct 2026, a Tuesday", () => {
  assert.equal(bsToAd({ year: 2083, month: 7, day: 4 }), "2026-10-20");
  assert.deepEqual(adToBs("2026-10-20"), { year: 2083, month: 7, day: 4 });
  assert.equal(weekdayOf("2026-10-20"), 2);
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

test("parseBsIso validates ranges", () => {
  assert.deepEqual(parseBsIso("2083-07-04"), { year: 2083, month: 7, day: 4 });
  assert.equal(parseBsIso("2083-13-01"), null);
  assert.equal(parseBsIso("2083-07-31"), null);
  assert.equal(parseBsIso("nope"), null);
  assert.equal(formatBsIso({ year: 2083, month: 7, day: 4 }), "2083-07-04");
});

test("Nepali formatting", () => {
  assert.equal(formatBsLongNp({ year: 2083, month: 7, day: 4 }), "कार्तिक ४, २०८३");
});
