import { test } from "node:test";
import assert from "node:assert/strict";
import { initialMonth, isValidTime, monthGrid, nowTimeKathmandu, shiftMonth } from "../pickerLogic.ts";

test("month grid: Kartik 2083 starts on Sunday 18 Oct, has 30 days, Saturdays flagged", () => {
  const g = monthGrid(2083, 7);
  assert.equal(g.titleNp, "कार्तिक २०८३");
  assert.equal(g.titleEn, "Kartik 2083");
  assert.equal(g.weeks[0][0]?.bs, "2083-07-01");
  assert.equal(g.weeks[0][0]?.ad, "2026-10-18");
  assert.equal(g.weeks[0][0]?.adDay, 18);
  assert.equal(g.weeks[0][0]?.dayNp, "१");
  const cells = g.weeks.flat().filter(Boolean);
  assert.equal(cells.length, 30);
  assert.ok(g.weeks.every((w) => w.length === 7));
  assert.ok(cells.filter((c) => c.saturday).every((c) => c.weekday === 6));
  assert.equal(cells.at(-1)?.bs, "2083-07-30");
});

test("month grid pads the first week and bounds navigation to the table", () => {
  const g = monthGrid(2083, 8); // Mangsir 1, 2083 = 17 Nov 2026 (Tuesday)
  assert.equal(g.weeks[0].filter((c) => c === null).length, 2);
  assert.equal(monthGrid(1975, 1).canGoPrev, false);
  assert.equal(monthGrid(2099, 12).canGoNext, false);
  assert.equal(monthGrid(2083, 7).canGoPrev, true);
  assert.throws(() => monthGrid(2100, 1), RangeError);
});

test("initialMonth prefers the typed value, falls back to today; shiftMonth wraps years", () => {
  assert.deepEqual(initialMonth("2082-03-10", "2083-07-06"), { year: 2082, month: 3 });
  assert.deepEqual(initialMonth("garbage", "2083-07-06"), { year: 2083, month: 7 });
  assert.deepEqual(shiftMonth(2083, 12, 1), { year: 2084, month: 1 });
  assert.deepEqual(shiftMonth(2083, 1, -1), { year: 2082, month: 12 });
});

test("time: Kathmandu clock and HH:MM validation", () => {
  assert.equal(nowTimeKathmandu(new Date(Date.UTC(2026, 9, 20, 18, 30))), "00:15");
  assert.equal(nowTimeKathmandu(new Date(Date.UTC(2026, 9, 20, 5, 0))), "10:45");
  assert.equal(isValidTime("10:42"), true);
  assert.equal(isValidTime("24:00"), false);
  assert.equal(isValidTime("9:05"), false);
  assert.equal(isValidTime(""), false);
});
