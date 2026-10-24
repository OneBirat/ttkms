import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  RANGE_PRESETS,
  addDays,
  adToBs,
  adToBsIso,
  bsMonthRange,
  bsToAd,
  compareMonths,
  dateBoth,
  dayBounds,
  daysInMonth,
  daysInYear,
  diffDays,
  fiscalYear,
  formatAd,
  formatAdRange,
  formatBs,
  formatBsRange,
  formatDateBoth,
  formatMonthRange,
  instantOf,
  isValidBs,
  isoBs,
  kathmanduDate,
  kathmanduTime,
  loadCalendar,
  monthDays,
  monthKey,
  monthLabel,
  nowInKathmandu,
  parseBs,
  parseMonthKey,
  presetOf,
  rangeFor,
  relativeLabel,
  shiftMonth,
  todayAd,
  todayBs,
  toNepaliDigits,
  weekdayInitial,
  weekdayName,
  weekdayOfAd,
  yearRange,
} from "./index";
import calendarData from "./calendar-data.json";

const official = JSON.parse(readFileSync(new URL("./fixtures/official-2082-2083.json", import.meta.url), "utf8")) as {
  years: Record<string, { months: number[]; month_first_days_ad: string[] }>;
  known_pairs: { bs: string; ad: string }[];
};

describe("calendar table", () => {
  it("covers 2070-2100 and every year is consistent with the next new year", () => {
    const [lo, hi] = yearRange();
    assert.ok(lo <= 2070 && hi >= 2100);
    for (let year = lo; year < hi; year++) {
      const next = bsToAd(isoBs(year + 1, 1, 1));
      assert.equal(daysInYear(year), diffDays(bsToAd(isoBs(year, 1, 1)), next), String(year));
    }
  });
  it("official Nepali Patro dates for 2082 and 2083 (shared fixture)", () => {
    for (const [year, entry] of Object.entries(official.years)) {
      const y = Number(year);
      assert.deepEqual(Array.from({ length: 12 }, (_, i) => daysInMonth(y, i + 1)), entry.months, year);
      entry.month_first_days_ad.forEach((first, i) => {
        assert.equal(bsToAd(isoBs(y, i + 1, 1)), first);
        assert.deepEqual(adToBs(first), { year: y, month: i + 1, day: 1 });
      });
    }
    for (const pair of official.known_pairs) {
      assert.equal(bsToAd(pair.bs), pair.ad, pair.bs);
      assert.equal(adToBsIso(pair.ad), pair.bs, pair.ad);
    }
  });
  it("round-trips every day from 2013-04-14 to 2043-04-13", () => {
    let ad = "2013-04-14";
    let previous: string | null = null;
    let count = 0;
    while (ad <= "2043-04-13") {
      const bs = adToBsIso(ad);
      assert.equal(bsToAd(bs), ad);
      if (previous) assert.ok(bs > previous, `${bs} after ${previous}`);
      previous = bs;
      ad = addDays(ad, 1);
      count++;
    }
    assert.equal(previous, "2099-12-30");
    assert.equal(count, diffDays("2013-04-14", "2043-04-13") + 1);
  });
  it("rejects dates outside the table and impossible days", () => {
    assert.throws(() => adToBs("1900-01-01"), RangeError);
    assert.throws(() => bsToAd("2083-07-31"), RangeError);
    assert.throws(() => daysInMonth(1800, 1), RangeError);
    assert.ok(isValidBs("2083-06-31") && !isValidBs("2083-06-32") && !isValidBs("2083-13-01") && !isValidBs("nope"));
    assert.deepEqual(parseBs(" 2083-7-7 "), { year: 2083, month: 7, day: 7 });
    assert.equal(parseBs("2083/07/07"), null);
  });
  it("overrides win over the package table and inconsistent ones are refused", () => {
    const months = [...calendarData.years["2090"].months];
    const shorter = months.indexOf(Math.max(...months));
    const longer = months.indexOf(Math.min(...months));
    months[shorter] -= 1;
    months[longer] += 1;
    const cal = loadCalendar(calendarData, { years: { "2090": { months, new_year_ad: calendarData.years["2090"].new_year_ad } } });
    assert.deepEqual(cal.months.get(2090), months);
    assert.deepEqual(cal.months.get(2089), calendarData.years["2089"].months);
    assert.deepEqual([...cal.overridden], [2090]);
    months[longer] -= 1;
    assert.throws(
      () => loadCalendar(calendarData, { years: { "2090": { months, new_year_ad: calendarData.years["2090"].new_year_ad } } }),
      /calendar-overrides.json: BS 2090 ends on/,
    );
    assert.throws(() => loadCalendar(calendarData, { years: { "2090": { months: [30] } } }), /needs 'months' and 'new_year_ad'/);
  });
});

describe("Nepal time", () => {
  it("today follows Kathmandu, not UTC (23:59 vs 00:01)", () => {
    assert.equal(todayAd("2026-10-24T18:14:00Z"), "2026-10-24");
    assert.equal(todayBs("2026-10-24T18:14:00Z"), "2083-07-07");
    assert.equal(todayAd("2026-10-24T18:16:00Z"), "2026-10-25");
    assert.equal(todayBs("2026-10-24T18:16:00Z"), "2083-07-08");
    const clock = nowInKathmandu("2026-10-24T18:16:30Z");
    assert.deepEqual([clock.ad, clock.bs, clock.hour, clock.minute, clock.second, clock.weekday], ["2026-10-25", "2083-07-08", 0, 1, 30, 0]);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(todayAd()));
  });
  it("timestamps map to Kathmandu days and wall-clock times", () => {
    assert.equal(kathmanduDate("2026-10-23T03:29:00Z"), "2026-10-23");
    assert.deepEqual(kathmanduTime("2026-10-23T03:29:00Z"), { hour: 9, minute: 14, second: 0 });
    assert.equal(instantOf("2026-10-25", 0, 1), "2026-10-24T18:16:00.000Z");
    assert.deepEqual(dayBounds("2026-10-25"), { start: "2026-10-24T18:15:00.000Z", end: "2026-10-25T18:15:00.000Z" });
  });
});

describe("months", () => {
  it("ranges, keys and days", () => {
    assert.deepEqual(bsMonthRange(2083, 7), { start: "2026-10-18", end: "2026-11-16" });
    assert.deepEqual(bsMonthRange(2083, 6), { start: "2026-09-17", end: "2026-10-17" });
    const days = monthDays(2083, 6);
    assert.equal(days.length, 31);
    assert.deepEqual(days[0], { bs: "2083-06-01", day: 1, ad: "2026-09-17", weekday: 4 });
    assert.deepEqual(days.filter((d) => d.weekday === 6).map((d) => d.day), [3, 10, 17, 24, 31]);
    assert.equal(monthKey(2083, 7), "2083-07");
    assert.deepEqual(parseMonthKey("2083-7"), { year: 2083, month: 7 });
    assert.equal(parseMonthKey("2083-13"), null);
    assert.deepEqual(shiftMonth(2083, 1, -1), { year: 2082, month: 12 });
    assert.deepEqual(shiftMonth(2083, 12, 1), { year: 2084, month: 1 });
    assert.deepEqual(shiftMonth(2083, 7, -26), { year: 2081, month: 5 });
    assert.ok(compareMonths({ year: 2083, month: 7 }, { year: 2083, month: 8 }) < 0);
    assert.equal(monthLabel(2083, 7), "Kartik 2083");
    assert.equal(monthLabel(2083, 7, "ne"), "कार्तिक २०८३");
  });
  it("fiscal year runs Shrawan to Ashadh", () => {
    assert.equal(fiscalYear("2083-04-01").label, "2083/84");
    assert.equal(fiscalYear("2083-03-32").label, "2082/83");
    assert.deepEqual(fiscalYear("2084-02-01"), { startYear: 2083, label: "2083/84", start: "2083-04-01", end: "2084-03-32" });
    assert.equal(fiscalYear("2099-12-01").label, "2099/00");
  });
});

describe("formatting", () => {
  it("BS and AD text in English and Nepali", () => {
    assert.equal(formatBs("2083-07-07"), "Kartik 7, 2083");
    assert.equal(formatBs("2083-07-07", "%B %-d, %Y", "ne"), "कार्तिक ७, २०८३");
    assert.equal(formatBs("2083-07-07", "%A, %B %-d, %Y"), "Saturday, Kartik 7, 2083");
    assert.equal(formatBs("2083-07-07", "%A, %B %-d", "ne"), "शनिबार, कार्तिक ७");
    assert.equal(formatBs("2083-07-07", "%a %d/%m/%Y %%"), "Sat 07/07/2083 %");
    assert.equal(formatBs("2083-07-07", "%-d %b %Y"), "7 Kar 2083");
    assert.equal(formatBs("garbage"), "garbage");
    assert.equal(formatAd("2026-10-24"), "24 Oct 2026");
    assert.equal(formatAd("2026-10-24", "%A %-d %B %Y"), "Saturday 24 October 2026");
    assert.equal(formatAd("2026-10-24", "%-d %b %Y", "ne"), "२४ Oct २०२६");
    assert.equal(formatDateBoth("2083-07-07"), "Kartik 7, 2083 · 24 Oct 2026");
    assert.equal(formatAdRange("2026-09-17", "2026-10-17"), "17 Sep – 17 Oct 2026");
    assert.equal(formatAdRange("2026-12-20", "2027-01-05"), "20 Dec 2026 – 5 Jan 2027");
    assert.equal(formatBsRange("2083-07-01", "2083-07-07"), "Kartik 1 – 7, 2083");
    assert.equal(formatBsRange("2083-06-01", "2083-07-07"), "Ashwin 1 – Kartik 7, 2083");
    assert.equal(formatBsRange("2082-12-20", "2083-01-05"), "Chaitra 20, 2082 – Baisakh 5, 2083");
    assert.equal(formatBsRange("2083-07-01", "2083-07-07", "ne"), "कार्तिक १ – ७, २०८३");
    assert.equal(formatMonthRange(2083, 7), "Kartik 1 – 30, 2083 · 18 Oct – 16 Nov 2026");
    assert.deepEqual(dateBoth("2083-07-07"), { bs: "2083-07-07", ad: "2026-10-24" });
    assert.equal(dateBoth("2083-07-31"), null);
    assert.equal(toNepaliDigits("2083-07-07"), "२०८३-०७-०७");
    assert.equal(weekdayName(weekdayOfAd("2026-10-24"), "ne"), "शनिबार");
    assert.equal(weekdayInitial(7), "आ");
  });
  it("relative labels", () => {
    const now = "2026-10-24T10:00:00Z";
    assert.equal(relativeLabel("2026-10-24", "ne", now), "आज");
    assert.equal(relativeLabel("2026-10-23", "ne", now), "हिजो");
    assert.equal(relativeLabel("2026-10-25", "ne", now), "भोलि");
    assert.equal(relativeLabel("2026-10-21", "ne", now), "३ दिन अघि");
    assert.equal(relativeLabel("2026-10-21", "en", now), "3 days ago");
    assert.equal(relativeLabel("2026-10-29", "en", now), "in 5 days");
    assert.equal(relativeLabel("2026-08-01", "en", now), null);
  });
});

describe("range presets", () => {
  it("end today in Kathmandu; last month is whole", () => {
    const now = "2026-10-24T10:00:00Z"; // Kartik 7, 2083
    assert.deepEqual(rangeFor("this_month", now), { from: "2083-07-01", to: "2083-07-07" });
    assert.deepEqual(rangeFor("last_month", now), { from: "2083-06-01", to: "2083-06-31" });
    assert.deepEqual(rangeFor("last_30", now), { from: "2083-06-09", to: "2083-07-07" });
    assert.deepEqual(rangeFor("last_3", now), { from: "2083-05-01", to: "2083-07-07" });
    assert.equal(presetOf({ from: "2083-06-01", to: "2083-06-31" }, now), "last_month");
    assert.equal(presetOf({ from: "2083-06-02", to: "2083-06-31" }, now), null);
    assert.equal(RANGE_PRESETS.length, 4);
  });
});
