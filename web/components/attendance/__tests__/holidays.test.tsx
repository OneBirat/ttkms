import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DayBanner, isOffDay } from "../DayBanner";
import { computeTotals } from "../helpers";
import { EMPTY_FORM, bodyOf, bsTile, calendarCells, formErrors, formOf, inDaysText, monthCounts, nextHoliday, scopeText, weekdayAndAd } from "../holidays/model";
import { pdfCell } from "../print";
import { cellLook, dayPillText } from "../reportPeriod";
import type { DayAttendance, Holiday } from "../types";
import { sheetCode } from "../xlsx";

// Kartik 2083 = 18 Oct - 16 Nov 2026 (30 days); 18 Oct is a Sunday. "Today" is 1 Nov (Kartik 15).
const TODAY = "2026-11-01";

function holiday(over: Partial<Holiday> = {}): Holiday {
  return {
    id: 1,
    date: "2026-11-08",
    date_bs: "2083-07-22",
    weekday: 0,
    name: "Tihar",
    all_branches: true,
    branch_ids: [],
    branch_names: [],
    is_paid: true,
    is_weekly_off: false,
    locked: false,
    ...over,
  };
}

const PAST = holiday({ id: 2, date: "2026-10-20", date_bs: "2083-07-03", name: "Dashain", locked: true });

describe("holiday calendar: the month grid", () => {
  const cells = calendarCells(2083, 7, [holiday(), PAST], TODAY);

  it("is seven columns Sunday - Saturday: the month's days, then muted days of the next month", () => {
    assert.equal(cells.length % 7, 0);
    assert.equal(cells.length, 35);
    const days = cells.filter((c) => c && !c.trailing);
    assert.equal(days.length, 30);
    assert.deepEqual([cells[0]?.bsDay, cells[0]?.adLabel, cells[0]?.weekday], [1, "18 Oct", 0]);
    const trailing = cells.filter((c) => c?.trailing);
    assert.deepEqual(trailing.map((c) => [c!.bs, c!.adLabel]), [
      ["2083-08-01", "17 Nov"],
      ["2083-08-02", "18 Nov"],
      ["2083-08-03", "19 Nov"],
      ["2083-08-04", "20 Nov"],
      ["2083-08-05", "21 Nov"],
    ]);
    // A month that does not start on a Sunday gets leading blanks (Mangsir 2083 starts on a Tuesday).
    const next = calendarCells(2083, 8, [], TODAY);
    assert.deepEqual(next.slice(0, 3).map((c) => c?.bsDay ?? null), [null, null, 1]);
  });

  it("marks today, past days (locked), Saturdays and holidays; a past holiday keeps its chip", () => {
    const by = new Map(cells.filter(Boolean).map((c) => [c!.bs, c!]));
    const today = by.get("2083-07-15")!;
    assert.deepEqual([today.isToday, today.past, today.ad], [true, false, TODAY]);
    assert.equal(by.get("2083-07-14")!.past, true);
    assert.equal(by.get("2083-07-16")!.past, false);
    assert.equal(by.get("2083-07-07")!.weeklyOff, true); // 24 Oct, a Saturday
    assert.equal(by.get("2083-07-22")!.holiday?.name, "Tihar");
    const old = by.get("2083-07-03")!;
    assert.deepEqual([old.past, old.holiday?.name], [true, "Dashain"]);
    assert.equal(by.get("2083-08-01")!.holiday, null); // trailing days carry nothing
  });

  it("counts: public holidays, weekly off, working days = the rest", () => {
    assert.deepEqual(monthCounts(2083, 7, [holiday(), PAST]), { holidays: 2, weeklyOff: 4, working: 24 });
    assert.deepEqual(monthCounts(2083, 7, []), { holidays: 0, weeklyOff: 4, working: 26 });
    // A holiday on a Saturday is not counted twice.
    const saturday = holiday({ id: 3, date: "2026-10-24", date_bs: "2083-07-07" });
    assert.deepEqual(monthCounts(2083, 7, [saturday]), { holidays: 0, weeklyOff: 4, working: 26 });
  });
});

describe("holiday calendar: the form", () => {
  it("checks the date, the name and the branches before saving", () => {
    assert.deepEqual(formErrors(EMPTY_FORM, TODAY), { date: "Pick a date.", name: "Give the holiday a name." });
    const past = { ...EMPTY_FORM, date_bs: "2083-07-14", name: "x" };
    assert.match(formErrors(past, TODAY).date ?? "", /has passed/);
    const today = { ...EMPTY_FORM, date_bs: "2083-07-15", name: "Tihar" };
    assert.deepEqual(formErrors(today, TODAY), {});
    assert.deepEqual(formErrors({ ...today, all_branches: false }, TODAY), { branch_ids: "Choose at least one branch." });
  });

  it("sends the AD date and no branches for an all-branches holiday", () => {
    const form = { ...formOf(holiday({ all_branches: false, branch_ids: [2, 3] })), name: "  Tihar  " };
    assert.deepEqual(bodyOf(form), { date: "2026-11-08", name: "Tihar", all_branches: false, branch_ids: [2, 3], is_paid: true });
    assert.deepEqual(bodyOf({ ...form, all_branches: true }).branch_ids, []);
  });
});

describe("dashboard: next public holiday", () => {
  it("is the first holiday today or later, with its tile, scope and distance", () => {
    const later = holiday({ id: 5, date: "2026-11-20", date_bs: "2083-08-04", name: "Chhath", all_branches: false, branch_names: ["Main branch", "Branch 2"] });
    assert.equal(nextHoliday([PAST, later, holiday()], TODAY)?.name, "Tihar");
    assert.equal(nextHoliday([PAST], TODAY), null);
    assert.equal(nextHoliday([holiday({ date: TODAY })], TODAY)?.date, TODAY);
    assert.deepEqual(bsTile("2083-07-22"), { day: "22", month: "Kartik" });
    assert.equal(weekdayAndAd("2026-11-08"), "Sunday · 8 Nov 2026");
    assert.equal(scopeText(holiday()), "All branches");
    assert.equal(scopeText(later), "Main branch, Branch 2");
    assert.deepEqual([inDaysText(TODAY, TODAY), inDaysText("2026-11-02", TODAY), inDaysText("2026-11-08", TODAY)], ["today", "tomorrow", "in 7 days"]);
  });
});

describe("holidays on the attendance screens", () => {
  const day = (over: Partial<DayAttendance> = {}): DayAttendance =>
    ({
      day: { bs_date: "2083-07-22", bs_day: 22, ad_date: "2026-11-08", weekday: 0, is_weekly_off: false },
      settings: { weekly_off: 6 },
      branches: [],
      departments: [],
      rows: [],
      ...over,
    }) as DayAttendance;

  it("Mark attendance: a banner for a public holiday and for the weekly off, nothing on a working day", () => {
    const banner = (data: DayAttendance) => renderToStaticMarkup(createElement(DayBanner, { data }));
    assert.equal(banner(day()), "");
    assert.match(banner(day({ holiday: { id: 1, name: "Tihar", is_paid: true } })), /Public holiday: Tihar/);
    const saturday = day({ day: { ...day().day, weekday: 6, is_weekly_off: true } });
    assert.match(banner(saturday), /Weekly off/);
    // The holiday label wins on a Saturday.
    assert.match(banner({ ...saturday, holiday: { id: 1, name: "Tihar", is_paid: true } }), /Public holiday: Tihar/);
    assert.deepEqual([isOffDay(day()), isOffDay(saturday), isOffDay(day({ holiday: { id: 1, name: "x", is_paid: false } }))], [false, true, true]);
  });

  it("the report shows a holiday as its own status: not absent, not not-marked", () => {
    const cell = { status: "H" as const, ot_hours: 0 };
    const header = { bs_date: "2083-07-03", bs_day: 3, ad_date: "2026-10-20", weekday: 2, is_weekly_off: false };
    assert.equal(cellLook(cell, header, "2083-07-15"), "H");
    assert.equal(dayPillText("H", 0), "Public holiday");
    assert.equal(sheetCode(cell), "H");
    assert.equal(pdfCell(cell).text, "H");
    const totals = computeTotals([cell, { status: "P", ot_hours: 0 }, { status: "N", ot_hours: 0, not_marked: true }]);
    assert.deepEqual([totals.holidays, totals.absent, totals.not_marked, totals.present], [1, 0, 1, 1]);
  });
});
