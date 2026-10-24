import { test } from "node:test";
import assert from "node:assert/strict";
import { addDaysBs, formatBs, formatBsDay, formatBsRange, toNepaliDigits } from "@/lib/bs";
import { monthEnd, monthStart, presetOf, rangeFor, thisMonth, today } from "../_lib/months.ts";

const NOW = new Date("2026-10-24T06:00:00Z"); // Kartik 7, 2083

test("Nepali digits and dates come from the shared library", () => {
  assert.equal(toNepaliDigits(2083), "२०८३");
  assert.equal(formatBs("2083-07-04", "%B %-d, %Y", "ne"), "कार्तिक ४, २०८३");
  assert.equal(formatBsDay("2083-07-04", "ne"), "कार्तिक ४");
});

test("range presets end today, last month covers the whole previous month", () => {
  const t = today(NOW).bs;
  assert.equal(t, "2083-07-07");
  const month = thisMonth(NOW);
  assert.deepEqual(month, { bs_year: 2083, bs_month: 7 });
  const thisM = rangeFor("this_month", NOW);
  assert.equal(thisM.from_bs, monthStart(month).bs);
  assert.equal(thisM.to_bs, t);
  const last = rangeFor("last_month", NOW);
  const previous = { bs_year: 2083, bs_month: 6 };
  assert.equal(last.from_bs, monthStart(previous).bs);
  assert.equal(last.to_bs, monthEnd(previous).bs);
  assert.equal(monthEnd(previous).bs, "2083-06-31");
  assert.equal(monthEnd(previous).ad, "2026-10-17");
  const last30 = rangeFor("last_30", NOW);
  assert.equal(last30.to_bs, t);
  assert.equal(addDaysBs(last30.from_bs, 29), t);
  const last3 = rangeFor("last_3", NOW);
  assert.ok(last3.from_bs < last.from_bs);
  assert.equal(presetOf(last30, NOW), "last_30");
  assert.equal(presetOf({ from_bs: "2083-01-01", to_bs: t }, NOW), null);
});

test("BS range label", () => {
  assert.equal(formatBsRange("2083-06-05", "2083-07-04"), "Ashwin 5 – Kartik 4, 2083");
  assert.equal(formatBsRange("2083-07-01", "2083-07-04"), "Kartik 1 – 4, 2083");
});
