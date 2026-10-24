import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WEEKDAY_INITIALS_NE, adToBs, bsToAd, daysInMonth, formatAdRange, isValidBs, shiftMonth, weekdayInitial } from "@/lib/bs";
import { buildMonth, dayFromBs, listMonths, todayRef } from "../calendar";
import {
  attendanceRate,
  cellCode,
  clampHours,
  computeTotals,
  countMarks,
  draftText,
  findByCode,
  groupByDepartment,
  initials,
  isLowPresence,
  matchesQuery,
  normalizeCode,
  openDays,
  paginate,
  paidDays,
  paymentError,
  presenceSummary,
  sliceRows,
  sliceWeeks,
  sortRows,
  staffPresentPerDay,
  weekIndexOfDay,
  weekLabel,
  weekdayKeyText,
} from "../helpers";
import type { CellStatus, DayCell, DayHeader, EmployeeRef, ReportRow } from "../types";

const month = buildMonth(2083, 6); // Ashwin 2083

function employee(id: number, department_id: number, name = `Emp ${id}`): EmployeeRef {
  return {
    id,
    code: `E-${String(id).padStart(3, "0")}`,
    name,
    branch_id: 1,
    branch_name: "Main branch",
    department_id,
    department_name: ["", "Store", "Kitchen"][department_id] ?? "Other",
  };
}

function cell(status: CellStatus, ot_hours = 0): DayCell {
  return { status, ot_hours: status === "O" ? ot_hours || 1 : 0 };
}

function row(emp: EmployeeRef, statuses: (CellStatus | [CellStatus, number])[]): ReportRow {
  const cells = statuses.map((s) => (Array.isArray(s) ? cell(s[0], s[1]) : cell(s)));
  return { employee: emp, cells, totals: computeTotals(cells) };
}

describe("BS dates (shared library)", () => {
  it("converts both ways", () => {
    assert.deepEqual(adToBs("2026-10-21"), { year: 2083, month: 7, day: 4 });
    assert.equal(bsToAd("2083-07-04"), "2026-10-21");
    assert.equal(bsToAd("2083-06-01"), "2026-09-17");
  });
  it("knows month lengths and validity", () => {
    assert.equal(daysInMonth(2083, 6), 31);
    assert.equal(daysInMonth(2083, 12) > 28, true);
    assert.ok(isValidBs("2083-06-31"));
    assert.ok(!isValidBs("2083-06-32"));
    assert.ok(!isValidBs("2083-13-01"));
    assert.ok(!isValidBs("nope"));
  });
  it("shifts months across the year boundary", () => {
    assert.deepEqual(shiftMonth(2083, 1, -1), { year: 2082, month: 12 });
    assert.deepEqual(shiftMonth(2083, 12, 1), { year: 2084, month: 1 });
  });
  it("formats AD ranges with the year once", () => {
    assert.equal(formatAdRange("2026-09-17", "2026-10-17"), "17 Sep – 17 Oct 2026");
    assert.equal(formatAdRange("2026-12-20", "2027-01-05"), "20 Dec 2026 – 5 Jan 2027");
  });
});

describe("Nepali weekday initials", () => {
  it("are the seven single initials in Sunday…Saturday order", () => {
    assert.deepEqual([...WEEKDAY_INITIALS_NE], ["आ", "सो", "मं", "बु", "बि", "शु", "श"]);
    assert.equal(weekdayInitial(6), "श");
    assert.equal(weekdayInitial(0), "आ");
    assert.equal(weekdayInitial(7), "आ");
  });
  it("legend key lists initial and day name", () => {
    assert.match(weekdayKeyText(), /^आ आइत · सो सोम · .* · श शनि$/);
  });
});

describe("calendar", () => {
  it("Ashwin 2083 runs 17 Sep – 17 Oct 2026 with Saturdays off", () => {
    assert.equal(month.ad_start, "2026-09-17");
    assert.equal(month.ad_end, "2026-10-17");
    assert.equal(month.days[0].weekday, 4); // Thursday
    assert.equal(month.working_days, 26);
    assert.deepEqual(
      month.days.filter((d) => d.is_weekly_off).map((d) => d.bs_day),
      [3, 10, 17, 24, 31],
    );
    assert.equal(month.label, "Ashwin 2083");
    assert.equal(month.label_np, "असोज २०८३");
  });
  it("gives today BS first and lists the current and previous months", () => {
    const today = todayRef(new Date(Date.UTC(2026, 9, 21, 6)));
    assert.equal(today.bs_date, "2083-07-04");
    assert.equal(today.bs_text, "Kartik 4, 2083");
    assert.equal(today.ad_text, "21 Oct 2026");
    assert.equal(today.np_text, "बुधबार, कार्तिक ४");
    assert.deepEqual(
      listMonths(new Date(Date.UTC(2026, 9, 21, 6))).map((m) => m.key),
      ["2083-05", "2083-06", "2083-07"],
    );
    assert.equal(dayFromBs("2083-07-04")?.ad_date, "2026-10-21");
    assert.equal(dayFromBs("2083-07-40"), null);
  });
});

describe("statuses and paid days", () => {
  it("paid days = present + overtime days + weekly off; absent unpaid", () => {
    assert.equal(paidDays({ present: 20, overtime_days: 3, weekly_off: 4 }), 27);
    const t = computeTotals([cell("P"), cell("O", 2), cell("A"), cell("W"), cell("N")]);
    assert.equal(t.paid_days, 3);
    assert.equal(t.absent, 1);
    assert.equal(t.overtime_hours, 2);
    assert.equal(t.marked_days, 3);
    assert.equal(t.attended, 2);
    assert.equal(t.not_marked, 1);
  });
  it("cell codes are P, O<hours>, A, – and blank", () => {
    assert.equal(cellCode(cell("P")), "P");
    assert.equal(cellCode(cell("O", 2)), "O2");
    assert.equal(cellCode(cell("A")), "A");
    assert.equal(cellCode(cell("W")), "–");
    assert.equal(cellCode(cell("N")), "");
  });
  it("overtime hours are whole and within 1–12", () => {
    assert.equal(clampHours(0), 1);
    assert.equal(clampHours(13), 12);
    assert.equal(clampHours(2.6), 3);
    assert.equal(clampHours(Number.NaN), 1);
  });
  it("attendance rate ignores weekly off and unmarked days", () => {
    const rows = [row(employee(1, 1), ["P", "A", "W", "N"])];
    assert.equal(attendanceRate(rows), 0.5);
    assert.equal(attendanceRate([row(employee(2, 1), ["N"])]), null);
  });
});

describe("marking drafts", () => {
  it("counts present (P), overtime (O + hours), absent and not marked", () => {
    const c = countMarks([
      { status: "P", ot_hours: 0, note: "" },
      { status: "O", ot_hours: 2, note: "" },
      { status: "O", ot_hours: 1, note: "" },
      { status: "A", ot_hours: 0, note: "" },
      { status: null, ot_hours: 0, note: "" },
    ]);
    assert.deepEqual(c, { total: 5, present: 1, overtime: 2, absent: 1, not_marked: 1, overtime_hours: 3 });
    assert.equal(draftText({ status: "O", ot_hours: 2, note: "" }), "Overtime · 2 h");
    assert.equal(draftText({ status: null, ot_hours: 0, note: "" }), "Not marked");
  });
});

describe("week slicing", () => {
  const weeks = sliceWeeks(month.days, "Ashwin");
  it("splits a BS month into Sunday–Saturday weeks", () => {
    assert.deepEqual(
      weeks.map((w) => [w.days[0].bs_day, w.days[w.days.length - 1].bs_day]),
      [[1, 3], [4, 10], [11, 17], [18, 24], [25, 31]],
    );
    assert.deepEqual(weeks.map((w) => w.offset), [0, 3, 10, 17, 24]);
  });
  it("labels weeks like the design", () => {
    assert.equal(weeks[0].label, "Ashwin 1–3 (week 1)");
    assert.equal(weeks[2].label, "Ashwin 11–17 (week 3)");
    assert.equal(weekLabel("Kartik", [month.days[0]], 1), "Kartik 1 (week 1)");
  });
  it("finds the week of a day and slices rows with fresh totals", () => {
    assert.equal(weekIndexOfDay(weeks, 12), 3);
    assert.equal(weekIndexOfDay(weeks, 99), 1);
    const r = row(employee(1, 1), month.days.map((d) => (d.is_weekly_off ? "W" : "P")));
    const sliced = sliceRows([r], weeks[1])[0];
    assert.equal(sliced.cells.length, 7);
    assert.equal(sliced.totals.present, 6);
    assert.equal(sliced.totals.weekly_off, 1);
    assert.equal(sliced.totals.paid_days, 7);
  });
});

describe("staff present per day", () => {
  const days: DayHeader[] = month.days.slice(0, 4); // Thu Fri Sat Sun
  const rows = [
    row(employee(1, 1), ["P", ["O", 2], "W", "A"]),
    row(employee(2, 1), ["O", "A", "W", "P"]),
    row(employee(3, 2), ["A", "P", "W", "N"]),
  ];
  it("counts P and O; null on the weekly off", () => {
    assert.deepEqual(staffPresentPerDay(rows, days), [2, 2, null, 1]);
  });
  it("summarises working days, present days, average and rate", () => {
    const s = presenceSummary(rows, days);
    assert.equal(s.working_days, 3);
    assert.equal(s.present_days, 5);
    assert.ok(Math.abs(s.avg_present - 5 / 3) < 1e-9);
    assert.ok(Math.abs((s.rate ?? 0) - 5 / 9) < 1e-9);
  });
  it("leaves days nobody has marked out of the average", () => {
    const future = [
      row(employee(1, 1), ["P", "N", "W", "N"]),
      row(employee(2, 1), ["A", "N", "W", "N"]),
    ];
    assert.deepEqual(openDays(future, days), [false, true, false, true]);
    const s = presenceSummary(future, days);
    assert.equal(s.working_days, 1);
    assert.equal(s.present_days, 1);
    assert.equal(s.rate, 0.5);
    assert.deepEqual(openDays([], days), [false, false, false, false]);
  });
  it("flags days under 80% of staff", () => {
    assert.equal(isLowPresence(20, 24), false);
    assert.equal(isLowPresence(18, 24), true);
    assert.equal(isLowPresence(0, 0), false);
  });
});

describe("sort and group", () => {
  const rows = [
    row(employee(1, 2, "Zara"), ["A", "A", ["O", 3]]),
    row(employee(2, 1, "Bina"), ["P", ["O", 1], ["O", 1]]),
    row(employee(3, 1, "Anil"), ["A", "P", "P"]),
  ];
  const order = [1, 2];
  it("department then name, and name only", () => {
    assert.deepEqual(sortRows(rows, "dept", false, order).map((r) => r.employee.name), ["Anil", "Bina", "Zara"]);
    assert.deepEqual(sortRows(rows, "name", false, order).map((r) => r.employee.name), ["Anil", "Bina", "Zara"]);
  });
  it("most absences, most overtime hours, ties by name", () => {
    assert.deepEqual(sortRows(rows, "absent", false, order).map((r) => r.employee.name), ["Zara", "Anil", "Bina"]);
    assert.deepEqual(sortRows(rows, "overtime", false, order).map((r) => r.employee.name), ["Zara", "Bina", "Anil"]);
  });
  it("grouping keeps departments together while sorting inside them", () => {
    const sorted = sortRows(rows, "absent", true, order);
    assert.deepEqual(sorted.map((r) => r.employee.name), ["Anil", "Bina", "Zara"]);
    const groups = groupByDepartment(sorted);
    assert.deepEqual(groups.map((g) => [g.department_name, g.rows.length]), [["Store", 2], ["Kitchen", 1]]);
    assert.ok(Math.abs((groups[0].rate ?? 0) - 5 / 6) < 1e-9);
  });
  it("does not mutate its input", () => {
    const copy = [...rows];
    sortRows(rows, "name", false, order);
    assert.deepEqual(rows, copy);
  });
});

describe("staff cards", () => {
  it("normalises every code shape to E-NNN", () => {
    for (const raw of ["TTK-E004", "ttk-e004", "E-004", "E004", "e4", "4", " 004 ", "TTK-4"]) {
      assert.equal(normalizeCode(raw), "E-004", raw);
    }
    assert.equal(normalizeCode("TTK-X917"), null);
    assert.equal(normalizeCode(""), null);
    assert.equal(normalizeCode("Kamala"), null);
  });
  it("finds the employee for a code", () => {
    const list = [employee(4, 1, "Kamala Bhandari"), employee(11, 2, "Laxmi Karki")];
    assert.equal(findByCode(list, "TTK-E011")?.name, "Laxmi Karki");
    assert.equal(findByCode(list, "TTK-X917"), null);
  });
  it("makes initials", () => {
    assert.equal(initials("Kamala Bhandari"), "KB");
    assert.equal(initials("Sunita B.K."), "SB");
    assert.equal(initials("Ram"), "R");
  });
});

describe("payments", () => {
  it("rejects zero and amounts above the balance due", () => {
    assert.equal(paymentError(0, 5000, "Kartik 2083"), "Enter an amount above 0.");
    assert.equal(paymentError(6000, 5000, "Kartik 2083"), "More than the balance due for Kartik 2083 (Rs 5,000).");
    assert.equal(paymentError(5000, 5000, "Kartik 2083"), null);
  });
});

describe("search and pagination", () => {
  it("matches name or code case-insensitively", () => {
    const e = employee(7, 1, "Sita Thapa");
    assert.ok(matchesQuery(e, "sita"));
    assert.ok(matchesQuery(e, "e-007"));
    assert.ok(matchesQuery(e, "  "));
    assert.ok(!matchesQuery(e, "ram"));
  });
  it("paginates and clamps the page", () => {
    const items = Array.from({ length: 27 }, (_, i) => i + 1);
    assert.deepEqual(paginate(items, 3, 10).items, [21, 22, 23, 24, 25, 26, 27]);
    assert.equal(paginate(items, 9, 10).page, 3);
    assert.equal(paginate([], 1, 10).pages, 1);
  });
});
