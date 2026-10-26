import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildMonth } from "../calendar";
import { computeTotals } from "../helpers";
import { MobileHeader, MonthCalendar, MonthStrip, WeekRow, dayMeta, departmentChips, mobileGroups, type MobileHeaderProps } from "../ReportMobileParts";
import {
  STRIP_COLOUR,
  calendarMark,
  cellLook,
  clockText,
  dayPillText,
  defaultPeriod,
  periodFromParams,
  periodIndices,
  periodParams,
  periodTitle,
  stepPeriod,
  weekMark,
  type Period,
  type PeriodBounds,
} from "../reportPeriod";
import type { CellStatus, DayCell, EmployeeRef, MonthReport, ReportRow } from "../types";

// Today: Kartik 8, 2083 (Sunday 25 Oct 2026). Kartik starts on a Sunday (18 Oct), 30 days:
// weeks 1–7, 8–14, 15–21, 22–28, 29–30. Ashwin 2083 starts on a Thursday, 31 days: 5 weeks.
const bounds: PeriodBounds = { months: ["2083-05", "2083-06", "2083-07"], today: "2083-07-08" };
const at = (view: Period["view"], month: string, week: number, day: number): Period => ({ view, month, week, day });

describe("phone report: period navigation", () => {
  it("starts on this month, this week, today", () => {
    assert.deepEqual(defaultPeriod(bounds), at("month", "2083-07", 2, 8));
  });

  it("Month: never into the future, back to the oldest offered month", () => {
    const now = defaultPeriod(bounds);
    assert.equal(stepPeriod(now, 1, bounds), null);
    const ashwin = stepPeriod(now, -1, bounds)!;
    assert.deepEqual(ashwin, at("month", "2083-06", 5, 31));
    assert.deepEqual(stepPeriod(ashwin, 1, bounds), at("month", "2083-07", 2, 8));
    const bhadra = stepPeriod(ashwin, -1, bounds)!;
    assert.equal(bhadra.month, "2083-05");
    assert.equal(stepPeriod(bhadra, -1, bounds), null);
  });

  it("Week: stops at the week of today and crosses month boundaries both ways", () => {
    assert.equal(stepPeriod(at("week", "2083-07", 2, 8), 1, bounds), null);
    assert.deepEqual(stepPeriod(at("week", "2083-07", 2, 8), -1, bounds), at("week", "2083-07", 1, 1));
    assert.deepEqual(stepPeriod(at("week", "2083-07", 1, 1), -1, bounds), at("week", "2083-06", 5, 31));
    assert.deepEqual(stepPeriod(at("week", "2083-06", 5, 31), 1, bounds), at("week", "2083-07", 1, 1));
    assert.deepEqual(stepPeriod(at("week", "2083-06", 2, 4), 1, bounds), at("week", "2083-06", 3, 11));
  });

  it("Day: stops at today and crosses month boundaries both ways", () => {
    assert.equal(stepPeriod(at("day", "2083-07", 2, 8), 1, bounds), null);
    assert.deepEqual(stepPeriod(at("day", "2083-07", 2, 8), -1, bounds), at("day", "2083-07", 1, 7));
    assert.deepEqual(stepPeriod(at("day", "2083-07", 1, 1), -1, bounds), at("day", "2083-06", 5, 31));
    assert.deepEqual(stepPeriod(at("day", "2083-06", 5, 31), 1, bounds), at("day", "2083-07", 1, 1));
  });

  it("titles: BS month with AD range, week of the month, day with आज", () => {
    assert.deepEqual(periodTitle(at("month", "2083-07", 2, 8), bounds.today), {
      title: "Kartik 2083",
      sub: "कार्तिक २०८३ · 18 Oct – 16 Nov 2026",
    });
    assert.deepEqual(periodTitle(at("week", "2083-07", 2, 8), bounds.today), {
      title: "Week 2 · Kartik 8–14",
      sub: "25 Oct – 31 Oct 2026",
    });
    assert.deepEqual(periodTitle(at("day", "2083-07", 2, 8), bounds.today), {
      title: "Kartik 8, 2083 · आज",
      sub: "25 Oct 2026 · Sunday",
    });
    assert.equal(periodTitle(at("day", "2083-07", 1, 7), bounds.today).title, "Kartik 7, 2083");
  });

  it("days in view", () => {
    assert.equal(periodIndices(at("month", "2083-07", 2, 8)).length, 30);
    assert.deepEqual(periodIndices(at("week", "2083-07", 2, 8)), [7, 8, 9, 10, 11, 12, 13]);
    assert.deepEqual(periodIndices(at("week", "2083-06", 1, 1)), [0, 1, 2]);
    assert.deepEqual(periodIndices(at("day", "2083-07", 2, 8)), [7]);
  });
});

describe("phone report: URL state", () => {
  const read = (qs: string) => periodFromParams(new URLSearchParams(qs), bounds);

  it("round-trips view, month, week and day", () => {
    const p = at("week", "2083-06", 3, 11);
    const params = new URLSearchParams(periodParams(p));
    assert.equal(params.toString(), "view=week&bs_year=2083&bs_month=6&week=3&day=11");
    assert.deepEqual(read(params.toString()), p);
  });

  it("empty or bad values fall back to today; the future is clamped", () => {
    assert.deepEqual(read(""), defaultPeriod(bounds));
    assert.equal(read("view=year").view, "month");
    assert.deepEqual(read("view=day&bs_year=2083&bs_month=7&day=20"), at("day", "2083-07", 2, 8));
    assert.deepEqual(read("view=week&bs_year=2083&bs_month=7&week=4"), at("week", "2083-07", 2, 8));
    assert.deepEqual(read("view=day&bs_year=2083&bs_month=8&day=2"), at("day", "2083-07", 2, 8));
    assert.deepEqual(read("view=month&bs_year=2083&bs_month=6"), at("month", "2083-06", 5, 31));
  });
});

// ------------------------------------------------------------ data

const kartik = buildMonth(2083, 7);

function emp(id: number, name: string, department_id: number, department_name: string, designation: string | null = null): EmployeeRef {
  return { id, code: `E-${String(id).padStart(3, "0")}`, name, branch_id: 1, branch_name: "Main branch", department_id, department_name, designation };
}

/** Cells for the 30 days: `first` for the first days, then not marked / weekly off as the server sends. */
function row(e: EmployeeRef, first: (CellStatus | [CellStatus, number])[]): ReportRow {
  const cells: DayCell[] = kartik.days.map((d, i) => {
    const s = first[i];
    if (s === undefined) return { status: d.is_weekly_off ? "W" : "N", ot_hours: 0 };
    return Array.isArray(s) ? { status: s[0], ot_hours: s[1] } : { status: s, ot_hours: 0 };
  });
  return { employee: e, cells, totals: computeTotals(cells) };
}

const anita = row(emp(1, "Anita Gurung", 10, "Store", "Store keeper"), ["P", ["O", 2], "A", "P", "P", "P", "W"]);
const ramesh = row(emp(2, "Ramesh K.C.", 10, "Store"), ["P", "P", "P", "P", "P", "P", "P", "P"]);
const bikash = row(emp(6, "Bikash Shrestha", 20, "Kitchen", "Head cook"), ["A"]);

const report: MonthReport = {
  month: kartik,
  settings: { weekly_off: 6 },
  branches: [
    { id: 1, name: "Main branch", headcount: 3 },
    { id: 2, name: "Branch 2", headcount: 1 },
  ],
  departments: [
    { id: 20, name: "Kitchen", headcount: 1 },
    { id: 10, name: "Store", headcount: 2 },
  ],
  rows: [ramesh, bikash, anita],
  generated_at: "2026-10-25T04:00:00Z",
};

describe("phone report: departments and search", () => {
  it("chips: All, then each department with its count", () => {
    assert.deepEqual(
      departmentChips(report).map((c) => `${c.name} ${c.count}`),
      ["All 3", "Kitchen 1", "Store 2"],
    );
  });

  it("groups by department in branch order, names A–Z; chip and search narrow it", () => {
    const shape = (dep: number | null, q: string) =>
      mobileGroups(report, dep, q).map((g) => `${g.department_name}: ${g.rows.map((r) => r.employee.name).join(", ")}`);
    assert.deepEqual(shape(null, ""), ["Kitchen: Bikash Shrestha", "Store: Anita Gurung, Ramesh K.C."]);
    assert.deepEqual(shape(10, ""), ["Store: Anita Gurung, Ramesh K.C."]);
    assert.deepEqual(shape(null, "ramesh"), ["Store: Ramesh K.C."]);
    assert.deepEqual(shape(null, "E-006"), ["Kitchen: Bikash Shrestha"]);
    assert.deepEqual(shape(20, "anita"), []);
    assert.deepEqual(mobileGroups(report, null, "", 1).map((g) => g.rows.length), [1]);
  });
});

// ------------------------------------------------------------ header

const header = (withSwitcher: boolean) => {
  const props: MobileHeaderProps = {
    subtitle: "Main branch · all departments",
    branchSwitcher: withSwitcher ? createElement("span", { "data-testid": "shell-switcher" }, "Main branch ▾") : undefined,
    onMenu: () => {},
    onDownload: () => {},
    title: "Kartik 2083",
    sub: "कार्तिक २०८३ · 18 Oct – 16 Nov 2026",
    canPrev: true,
    canNext: false,
    onPrev: () => {},
    onNext: () => {},
    view: "week",
    onView: () => {},
  };
  return renderToStaticMarkup(createElement(MobileHeader, props));
};

describe("phone report: header", () => {
  it("no page-level branch dropdown: the shell's switcher goes in the header", () => {
    const bare = header(false);
    assert.doesNotMatch(bare, /<select/);
    assert.match(bare, /Main branch · all departments/);
    const html = header(true);
    assert.match(html, /data-testid="shell-switcher"/);
    assert.doesNotMatch(html, /All branches|branch-pill/);
  });

  it("dims › at the limit and marks the selected view", () => {
    const html = header(false);
    assert.match(html, /aria-label="Previous"[^>]*>‹/);
    assert.match(html, /aria-label="Next"[^>]*disabled=""/);
    assert.match(html, /aria-selected="true"[^>]*>Week</);
    assert.match(html, /aria-selected="false"[^>]*>Month</);
  });
});

// ------------------------------------------------------------ cells

describe("phone report: cell colours per status", () => {
  const sat = kartik.days[6];
  const sun = kartik.days[7];
  const future = kartik.days[8];

  it("looks: marks, Saturday, not marked, future", () => {
    assert.equal(cellLook({ status: "P", ot_hours: 0 }, kartik.days[0], bounds.today), "P");
    assert.equal(cellLook({ status: "W", ot_hours: 0 }, sat, bounds.today), "W");
    assert.equal(cellLook({ status: "P", ot_hours: 0 }, sat, bounds.today), "P");
    assert.equal(cellLook({ status: "N", ot_hours: 0 }, sun, bounds.today), "N");
    assert.equal(cellLook({ status: "N", ot_hours: 0 }, future, bounds.today), "F");
  });

  it("texts: calendar, week box and day pill", () => {
    assert.deepEqual(["P", "O", "A", "W", "N", "F"].map((k) => calendarMark(k as never, 2)), ["P", "O 2h", "A", "W", "–", ""]);
    assert.deepEqual(["P", "O", "A", "W", "N", "F"].map((k) => weekMark(k as never, 2)), ["P", "2h", "A", "W", "–", ""]);
    assert.deepEqual(["P", "O", "A", "W", "N"].map((k) => dayPillText(k as never, 3)), ["Present", "Overtime · 3 h", "Absent", "Saturday", "Not marked"]);
    assert.equal(clockText(9, 14), "9:14 am");
    assert.equal(clockText(12, 5), "12:05 pm");
    assert.equal(clockText(0, 0), "12:00 am");
  });

  it("month strip: one block per day in the design colours", () => {
    const html = renderToStaticMarkup(createElement(MonthStrip, { row: anita, days: kartik.days, today: bounds.today, hideSat: false }));
    const blocks = [...html.matchAll(/data-look="(\w)" style="([^"]*)"/g)];
    assert.equal(blocks.length, 30);
    assert.deepEqual(blocks.slice(0, 9).map((b) => b[1]), ["P", "O", "A", "P", "P", "P", "W", "N", "F"]);
    assert.match(blocks[0][2], new RegExp(`background:${STRIP_COLOUR.P}`));
    assert.match(blocks[1][2], /background:#E0A800/);
    assert.match(blocks[2][2], /background:#C0392B/);
    assert.match(blocks[6][2], /background:#D5D9D5/);
    assert.match(blocks[7][2], /background:#FFFFFF;box-shadow:inset 0 0 0 1.5px #C0392B/);
    assert.match(blocks[8][2], /background:#FFFFFF;box-shadow:inset 0 0 0 1px #E2E5E1/);
    const hidden = renderToStaticMarkup(createElement(MonthStrip, { row: anita, days: kartik.days, today: bounds.today, hideSat: true }));
    assert.equal([...hidden.matchAll(/data-look=/g)].length, 26);
  });

  it("calendar: pale colours, today outlined, future dashed, summary line", () => {
    const html = renderToStaticMarkup(createElement(MonthCalendar, { row: anita, days: kartik.days, today: bounds.today }));
    assert.match(html, /data-look="P" style="background:#E6F5F3;color:#0A5454/);
    assert.match(html, /data-look="O" style="background:#FFF4CC;color:#7A5600[^"]*"><b[^>]*>2<\/b><span[^>]*>19 Oct<\/span><span[^>]*>O 2h</);
    assert.match(html, /data-look="A" style="background:#FBE9E4;color:#8E2F12/);
    assert.match(html, /data-look="W" style="background:#F4F5F2;color:#B42318/);
    assert.match(html, /data-look="N" style="[^"]*border:1px dashed #C0392B;box-shadow:0 0 0 2px #0E6B6B/);
    assert.match(html, /data-look="F" style="[^"]*border:1px dashed #E2E5E1"/);
    assert.match(html, /Present 4 · Overtime 1 days \(2 h\) · Absent 1/);
  });

  it("week row: 7 boxes, blank outside the month", () => {
    const html = renderToStaticMarkup(createElement(WeekRow, { row: anita, days: kartik.days, indices: [0, 1, 2, 3, 4, 5, 6], today: bounds.today }));
    assert.match(html, /P 4 · O 1 · A 1/);
    assert.deepEqual([...html.matchAll(/data-look="\w"[^>]*>([^<]*)</g)].map((m) => m[1]), ["P", "2h", "A", "P", "P", "P", "W"]);
    const last = renderToStaticMarkup(createElement(WeekRow, { row: anita, days: kartik.days, indices: [28, 29], today: bounds.today }));
    assert.equal([...last.matchAll(/data-look="F"/g)].length, 2);
    assert.equal([...last.matchAll(/weekEmpty/g)].length, 5);
  });

  it("day meta: marked time and how, absent, not marked, designation", () => {
    const rec = { employee_id: 1, date_bs: "2083-07-08", date_ad: "2026-10-25", status: "P" as const, ot_hours: 0, note: "", marked_by: "x", marked_via: "scan" as const, updated_at: "2026-10-25T03:29:00Z" };
    assert.equal(dayMeta(anita, "P", rec), "E-001 · marked 9:14 am · scan");
    assert.equal(dayMeta(anita, "A", { ...rec, marked_via: "bulk" }), "E-001 · marked absent · 9:14 am · manual");
    assert.equal(dayMeta(anita, "N", undefined), "E-001 · not marked yet");
    assert.equal(dayMeta(anita, "W", undefined), "E-001 · Store keeper");
    assert.equal(dayMeta(ramesh, "W", undefined), "E-002");
  });
});
