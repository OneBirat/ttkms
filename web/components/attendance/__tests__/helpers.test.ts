import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WEEKDAY_INITIALS_NP,
  attendanceRate,
  computeTotals,
  formatAdRange,
  groupByDepartment,
  isLateArrival,
  isLowPresence,
  isValidTime,
  matchesQuery,
  openDays,
  paginate,
  paidDays,
  presenceSummary,
  sliceRows,
  sliceWeeks,
  sortRows,
  staffPresentPerDay,
  weekIndexOfDay,
  weekLabel,
  weekdayInitial,
  weekdayKeyText,
} from "../helpers";
import type { DayCell, DayHeader, EmployeeRef, ReportRow } from "../types";
import { buildMonth, dayFromBs, mockToday } from "../mock/calendar";

const month = buildMonth({ bs_year: 2083, bs_month: 6, ad_start: "2026-09-17", days: 30 });

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

function cell(status: DayCell["status"], in_time: string | null = null): DayCell {
  return { status, in_time, out_time: null };
}

function row(emp: EmployeeRef, statuses: DayCell["status"][]): ReportRow {
  const cells = statuses.map((s) => cell(s));
  return { employee: emp, cells, totals: computeTotals(cells) };
}

describe("Nepali weekday initials", () => {
  it("are the seven single initials in Sunday…Saturday order", () => {
    assert.deepEqual([...WEEKDAY_INITIALS_NP], ["आ", "सो", "मं", "बु", "बि", "शु", "श"]);
    assert.equal(weekdayInitial(6), "श");
    assert.equal(weekdayInitial(0), "आ");
    assert.equal(weekdayInitial(7), "आ");
  });
  it("legend key lists initial and day name", () => {
    assert.match(weekdayKeyText(), /^आ आइत · सो सोम · .* · श शनि$/);
  });
});

describe("paid days", () => {
  it("present + late + leave + weekly off + half a day per half day", () => {
    assert.equal(paidDays({ present: 20, late: 2, leave: 1, weekly_off: 4, half_day: 3 }), 28.5);
  });
  it("absent is unpaid", () => {
    const t = computeTotals([cell("present"), cell("absent"), cell("weekly_off"), cell("half_day")]);
    assert.equal(t.paid_days, 2.5);
    assert.equal(t.absent, 1);
  });
});

describe("totals", () => {
  it("counts each status, marked days and attended", () => {
    const t = computeTotals([
      cell("present"), cell("present"), cell("late"), cell("half_day"), cell("leave"),
      cell("absent"), cell("weekly_off"), cell("not_marked"),
    ]);
    assert.equal(t.present, 2);
    assert.equal(t.late, 1);
    assert.equal(t.half_day, 1);
    assert.equal(t.leave, 1);
    assert.equal(t.absent, 1);
    assert.equal(t.weekly_off, 1);
    assert.equal(t.not_marked, 1);
    assert.equal(t.marked_days, 6);
    assert.equal(t.attended, 3.5);
    assert.equal(t.paid_days, 5.5);
  });
  it("attendance rate ignores weekly off and unmarked days", () => {
    const rows = [row(employee(1, 1), ["present", "absent", "weekly_off", "not_marked"])];
    assert.equal(attendanceRate(rows), 0.5);
    assert.equal(attendanceRate([row(employee(2, 1), ["not_marked"])]), null);
  });
});

describe("month calendar (mock)", () => {
  it("Ashoj 2083 runs 17 Sep – 16 Oct 2026 with Saturdays off", () => {
    assert.equal(month.ad_end, "2026-10-16");
    assert.equal(month.days[0].weekday, 4); // Thursday
    assert.equal(month.working_days, 26);
    assert.deepEqual(
      month.days.filter((d) => d.is_weekly_off).map((d) => d.bs_day),
      [3, 10, 17, 24],
    );
  });
  it("today falls back to the design's date outside the mock months", () => {
    assert.equal(mockToday(new Date(2020, 0, 1)).bs_date, "2083-07-04");
    assert.equal(mockToday(new Date(2026, 9, 20)).bs_date, "2083-07-04");
    assert.equal(dayFromBs("2083-07-04")?.ad_date, "2026-10-20");
  });
});

describe("week slicing", () => {
  const weeks = sliceWeeks(month.days, "Ashoj");
  it("splits a BS month into Sunday–Saturday weeks", () => {
    assert.deepEqual(
      weeks.map((w) => [w.days[0].bs_day, w.days[w.days.length - 1].bs_day]),
      [[1, 3], [4, 10], [11, 17], [18, 24], [25, 30]],
    );
    assert.deepEqual(weeks.map((w) => w.offset), [0, 3, 10, 17, 24]);
  });
  it("labels weeks like the design", () => {
    assert.equal(weeks[0].label, "Ashoj 1–3 (week 1)");
    assert.equal(weeks[2].label, "Ashoj 11–17 (week 3)");
    assert.equal(weekLabel("Kartik", [month.days[0]], 1), "Kartik 1 (week 1)");
  });
  it("finds the week of a day and slices rows with fresh totals", () => {
    assert.equal(weekIndexOfDay(weeks, 12), 3);
    assert.equal(weekIndexOfDay(weeks, 99), 1);
    const r = row(employee(1, 1), month.days.map((d) => (d.is_weekly_off ? "weekly_off" : "present")));
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
    row(employee(1, 1), ["present", "late", "weekly_off", "absent"]),
    row(employee(2, 1), ["half_day", "absent", "weekly_off", "present"]),
    row(employee(3, 2), ["leave", "present", "weekly_off", "not_marked"]),
  ];
  it("counts present, late and half day; null on the weekly off", () => {
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
      row(employee(1, 1), ["present", "not_marked", "weekly_off", "not_marked"]),
      row(employee(2, 1), ["absent", "not_marked", "weekly_off", "not_marked"]),
    ];
    assert.deepEqual(openDays(future, days), [false, true, false, true]);
    const s = presenceSummary(future, days);
    assert.equal(s.working_days, 1);
    assert.equal(s.present_days, 1);
    assert.equal(s.avg_present, 1);
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
    row(employee(1, 2, "Zara"), ["absent", "absent", "late"]),
    row(employee(2, 1, "Bina"), ["present", "late", "late"]),
    row(employee(3, 1, "Anil"), ["absent", "present", "present"]),
  ];
  const order = [1, 2];
  it("department then name", () => {
    assert.deepEqual(sortRows(rows, "dept", false, order).map((r) => r.employee.name), ["Anil", "Bina", "Zara"]);
  });
  it("name only", () => {
    assert.deepEqual(sortRows(rows, "name", false, order).map((r) => r.employee.name), ["Anil", "Bina", "Zara"]);
  });
  it("most absences, most late days, ties by name", () => {
    assert.deepEqual(sortRows(rows, "absent", false, order).map((r) => r.employee.name), ["Zara", "Anil", "Bina"]);
    assert.deepEqual(sortRows(rows, "late", false, order).map((r) => r.employee.name), ["Bina", "Zara", "Anil"]);
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

describe("search, pagination, times, dates", () => {
  it("matches name or code case-insensitively", () => {
    const e = employee(7, 1, "Sita Thapa");
    assert.ok(matchesQuery(e, "sita"));
    assert.ok(matchesQuery(e, "e-007"));
    assert.ok(matchesQuery(e, "  "));
    assert.ok(!matchesQuery(e, "ram"));
  });
  it("paginates and clamps the page", () => {
    const items = Array.from({ length: 27 }, (_, i) => i + 1);
    assert.deepEqual(paginate(items, 2, 25).items, [26, 27]);
    assert.equal(paginate(items, 9, 25).page, 2);
    assert.equal(paginate([], 1, 25).pages, 1);
  });
  it("validates HH:MM and the late threshold", () => {
    assert.ok(isValidTime("09:30"));
    assert.ok(!isValidTime("9:30"));
    assert.ok(!isValidTime("24:00"));
    assert.ok(isLateArrival("09:31", "09:30"));
    assert.ok(!isLateArrival("09:30", "09:30"));
    assert.ok(!isLateArrival(null, "09:30"));
  });
  it("formats AD ranges with the year once", () => {
    assert.equal(formatAdRange("2026-09-17", "2026-10-16"), "17 Sep – 16 Oct 2026");
    assert.equal(formatAdRange("2026-12-20", "2027-01-05"), "20 Dec 2026 – 5 Jan 2027");
  });
});
