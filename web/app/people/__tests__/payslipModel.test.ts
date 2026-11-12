import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LINES_4UP, absentDatesText, formatRate, parseIds, sheetTexts, sheetsOf, slipCopies, slipText } from "../_lib/payslipModel";
import type { Payslip, PayslipPayment } from "../types";

const advance = (bs: string, amount: number, kind: "advance" | "salary" = "advance", mode = "Cash"): PayslipPayment => ({ date: { bs, ad: "2026-10-29" }, kind, mode, amount });

function slip(over: Partial<Payslip> = {}, employee: Partial<Payslip["employee"]> = {}): Payslip {
  return {
    employee: { id: 22, code: "E-022", name: "Rajan Poudel", role: "Accounts assistant", department: "Accounts", pay_type: "monthly", rate: 26000, ...employee },
    month: { bs_year: 2083, bs_month: 7, name: "Kartik", days_in_month: 30 },
    in_progress: false,
    days_counted: 30,
    paid_days: 30,
    absent_days: 0,
    absent_dates: [],
    overtime_hours: 0,
    overtime_amount: 0,
    overtime_rate: 108,
    base_amount: 26000,
    day_rate: 866.67,
    absence_deduction: 0,
    deductions: [],
    earned: 26000,
    advances: [],
    advances_total: 0,
    balance_due: 26000,
    unmarked_days: 0,
    slip_printed_at: null,
    slip_printed_by: null,
    ...over,
  };
}

const lines = (s: Payslip, layout: 4 | 6 | 8) => {
  const t = slipText(s, layout);
  return [t.base, ...t.deductions, t.overtime, ...t.payments].map((l) => [l.label, l.note, l.amount].join(" | "));
};

const absentTwo = slip({
  paid_days: 28,
  absent_days: 2,
  absent_dates: ["2083-07-07", "2083-07-21"],
  absence_deduction: 1733,
  deductions: [{ reason: "absent", days: 2, amount: 1733 }],
  overtime_hours: 10,
  overtime_amount: 1080,
  earned: 25347,
  advances: [advance("2083-07-05", 1500), advance("2083-07-18", 1500)],
  advances_total: 3000,
  balance_due: 22347,
});

describe("pay slip lines", () => {
  it("no absence: the Absence line and the Absent cell are not there at all", () => {
    for (const layout of [4, 6, 8] as const) {
      const t = slipText(slip(), layout);
      assert.deepEqual(t.deductions, []);
      assert.equal(t.absent, null);
      assert.doesNotMatch(JSON.stringify(t), /Absen/);
    }
    assert.equal(slipText(slip(), 6).attendanceLine, "Paid days 30/30 · Overtime 0 h");
    assert.deepEqual(lines(slip(), 4), ["Monthly salary |  | 26,000", "Overtime | 0 h × 108 | 0", "Advance | none this month | 0"]);
  });

  it("4 per page: absence with dates, overtime, one line per advance", () => {
    const t = slipText(absentTwo, 4);
    assert.equal(t.sub, "E-022 · Accounts assistant · Accounts");
    assert.equal(t.paidDays, "28/30");
    assert.deepEqual(t.absent, { days: "2 days", dates: "Kartik 7, 21" });
    assert.equal(t.overtimeHours, "10 h");
    assert.deepEqual(lines(absentTwo, 4), [
      "Monthly salary |  | 26,000",
      "Absence | 2 × 866.67 | −1,733",
      "Overtime | 10 h × 108 | +1,080",
      "Advance | Kartik 5 · Cash | −1,500",
      "Advance | Kartik 18 · Cash | −1,500",
    ]);
    assert.equal(t.earned, "25,347");
    assert.equal(t.balance, "Rs 22,347");
  });

  it("6 per page: one attendance line, one advances line", () => {
    const t = slipText(absentTwo, 6);
    assert.equal(t.attendanceLine, "Paid days 28/30 · Absent 2 · Overtime 10 h");
    assert.deepEqual(lines(absentTwo, 6), ["Monthly salary |  | 26,000", "Absence | 2 × 866.67 | −1,733", "Overtime | 10 h × 108 | +1,080", "Advances | 2 payments | −3,000"]);
    assert.deepEqual(lines(slip(), 6).at(-1), "Advances | none | 0");
    assert.equal(lines(slip({ advances: [advance("2083-07-05", 500)], advances_total: 500 }), 6).at(-1), "Advances | 1 payment | −500");
  });

  it("8 per page: the smallest - code · department · paid days, short notes", () => {
    const t = slipText(absentTwo, 8);
    assert.equal(t.sub, "E-022 · Accounts · paid days 28/30");
    assert.deepEqual(lines(absentTwo, 8), ["Salary |  | 26,000", "Absence | 2 days | −1,733", "Overtime | 10 h | +1,080", "Advances | × 2 | −3,000"]);
    assert.equal(lines(slip(), 8).at(-1), "Advances | none | 0");
    assert.equal(slipText(slip({ absent_days: 1, deductions: [{ reason: "absent", days: 1, amount: 867 }] }), 8).deductions[0].note, "1 day");
  });

  it("daily wage: days × wage, the Absent cell without a deduction line", () => {
    const daily = slip({ paid_days: 24, absent_days: 1, absent_dates: ["2083-07-14"], base_amount: 15600, day_rate: 650, overtime_rate: 81, earned: 15600, balance_due: 15600 }, { pay_type: "daily", rate: 650, role: null });
    const t = slipText(daily, 4);
    assert.deepEqual([t.base.label, t.base.note, t.base.amount], ["Wage", "24 days × 650", "15,600"]);
    assert.deepEqual(t.deductions, []);
    assert.deepEqual(t.absent, { days: "1 day", dates: "Kartik 14" });
    assert.equal(t.sub, "E-022 · — · Accounts");
    assert.equal(slipText(daily, 8).base.label, "Wage");
  });

  it("one line per unpaid reason; a reason without days prints nothing", () => {
    const s = slip({
      absent_days: 1,
      absent_dates: ["2083-07-07"],
      unmarked_days: 3,
      absence_deduction: 3467,
      deductions: [
        { reason: "absent", days: 1, amount: 867 },
        { reason: "not_marked", days: 3, amount: 2600 },
        { reason: "after_leaving", days: 0, amount: 0 },
      ],
      earned: 22533,
      balance_due: 22533,
    });
    assert.deepEqual(slipText(s, 4).deductions.map((d) => [d.label, d.note, d.amount]), [
      ["Absence", "1 × 866.67", "−867"],
      ["Not marked", "3 × 866.67", "−2,600"],
    ]);
    const all = slip({
      deductions: [
        { reason: "not_marked", days: 2, amount: 1733 },
        { reason: "after_leaving", days: 4, amount: 3467 },
        { reason: "unpaid_holiday", days: 1, amount: 867 },
      ],
    });
    assert.deepEqual(slipText(all, 8).deductions.map((d) => `${d.label} · ${d.note}`), ["Not marked · 2 days", "After leaving · 4 days", "Unpaid holiday · 1 day"]);
    // Not marked days alone: no Absent cell, but the deduction is explained.
    assert.equal(slipText(all, 4).absent, null);
  });

  it("4 per page: more than 5 payments become one line with the total", () => {
    const five = Array.from({ length: 5 }, (_, i) => advance(`2083-07-${String(i + 2).padStart(2, "0")}`, 500));
    assert.equal(slipText(slip({ advances: five, advances_total: 2500 }), 4).payments.length, 5);
    const six = [...five, advance("2083-07-20", 500)];
    assert.deepEqual(slipText(slip({ advances: six, advances_total: 3000 }), 4).payments.map((p) => [p.label, p.note, p.amount]), [["Advances", "6 payments", "−3,000"]]);
  });

  it("4 per page: the slip never grows past its cell - payments collapse when the lines run out", () => {
    const five = Array.from({ length: 5 }, (_, i) => advance(`2083-07-${String(i + 2).padStart(2, "0")}`, 500));
    const twoReasons = slip({
      deductions: [
        { reason: "absent", days: 1, amount: 867 },
        { reason: "not_marked", days: 1, amount: 867 },
      ],
      advances: five,
      advances_total: 2500,
    });
    const t = slipText(twoReasons, 4);
    assert.deepEqual(t.payments.map((p) => p.note), ["5 payments"]);
    // base + deductions + overtime + earned + payments
    assert.ok(3 + t.deductions.length + t.payments.length <= LINES_4UP);
    const four = slipText({ ...twoReasons, advances: five.slice(0, 4), advances_total: 2000 }, 4);
    assert.equal(four.payments.length, 4);
  });

  it("payments are labelled by kind", () => {
    const mixed = [advance("2083-07-12", 4000), advance("2083-07-30", 10000, "salary", "Bank")];
    const s = slip({ advances: mixed, advances_total: 14000, balance_due: 12000 });
    assert.deepEqual(slipText(s, 4).payments.map((p) => `${p.label} · ${p.note} · ${p.amount}`), ["Advance · Kartik 12 · Cash · −4,000", "Salary paid · Kartik 30 · Bank · −10,000"]);
    assert.equal(lines(s, 6).at(-1), "Paid | 2 payments | −14,000");
    assert.equal(lines(s, 8).at(-1), "Paid | × 2 | −14,000");
  });

  it("the running month says how many days the salary covers", () => {
    const t = slipText(slip({ in_progress: true, days_counted: 26, base_amount: 22533 }), 4);
    assert.deepEqual([t.base.label, t.base.note, t.base.amount], ["Monthly salary", "26 of 30 days so far", "22,533"]);
    assert.equal(slipText(slip({ in_progress: true, days_counted: 32 }), 6).base.note, "30 of 30 days so far");
  });

  it("no slip counter, no TDS, no SSF anywhere", () => {
    for (const layout of [4, 6, 8] as const) assert.doesNotMatch(JSON.stringify(slipText(absentTwo, layout)), /TDS|SSF|\d+ \/ \d+|1 of/i);
  });
});

describe("pay slip formatting", () => {
  it("rates: paisa only when there are any, Indian grouping", () => {
    assert.deepEqual([866.67, 1000, 1166.5, 108, 123456.78, 0].map(formatRate), ["866.67", "1,000", "1,166.50", "108", "1,23,456.78", "0"]);
  });

  it("absent dates: the month once, then the days", () => {
    assert.equal(absentDatesText([]), "");
    assert.equal(absentDatesText(["2083-07-14"]), "Kartik 14");
    assert.equal(absentDatesText(["2083-07-07", "2083-07-21", "2083-07-29"]), "Kartik 7, 21, 29");
  });

  it("header texts and the print date are BS", () => {
    const texts = sheetTexts({ business: "TTK", branch: { id: 1, name: "Main branch", is_active: true }, month: { bs_year: 2083, bs_month: 7 }, today: { bs: "2083-07-26", ad: "2026-11-12" } } as never);
    assert.deepEqual(texts, { place: "TTK · Main branch", business: "TTK", month: "Kartik 2083", printed: "Printed Kartik 26, 2083" });
  });

  it("ids from the link: order kept, repeats and junk dropped", () => {
    assert.deepEqual(parseIds("5,2,9,2"), [5, 2, 9]);
    assert.deepEqual(parseIds("3,,x,-1,0,4.5,7"), [3, 7]);
    assert.deepEqual(parseIds(null), []);
  });
});

describe("pay slip sheets", () => {
  const people = (n: number) => Array.from({ length: n }, (_, i) => slip({}, { id: i + 1, name: `P${i + 1}` }));
  const shape = (sheets: ReturnType<typeof sheetsOf>) => sheets.map((cells) => cells.map((c) => `${c.slip.employee.id}${c.office ? "o" : ""}`).join(" "));

  it("fills sheets in order; the last one may be partly empty", () => {
    assert.deepEqual(shape(sheetsOf(slipCopies(people(10), false), 4)), ["1 2 3 4", "5 6 7 8", "9 10"]);
    assert.deepEqual(shape(sheetsOf(slipCopies(people(10), false), 6)), ["1 2 3 4 5 6", "7 8 9 10"]);
    assert.deepEqual(shape(sheetsOf(slipCopies(people(10), false), 8)), ["1 2 3 4 5 6 7 8", "9 10"]);
    assert.deepEqual(sheetsOf([], 4), []);
  });

  it("office copy: the two copies of one employee sit next to each other", () => {
    assert.deepEqual(shape(sheetsOf(slipCopies(people(3), true), 4)), ["1 1o 2 2o", "3 3o"]);
    assert.equal(sheetsOf(slipCopies(people(10), true), 6).length, 4);
  });

  it("cut lines only between two slips: none on the outer edge, none around an empty cell", () => {
    const cuts = (n: number, per: 4 | 6 | 8) => sheetsOf(slipCopies(people(n), false), per)[0].map((c) => `${c.cutRight ? "R" : "-"}${c.cutBelow ? "B" : "-"}`);
    assert.deepEqual(cuts(4, 4), ["RB", "-B", "R-", "--"]);
    assert.deepEqual(cuts(6, 6), ["RB", "-B", "RB", "-B", "R-", "--"]);
    assert.deepEqual(cuts(8, 8).slice(-4), ["RB", "-B", "R-", "--"]);
    // Three slips on a 4-up sheet: nothing beside or below the empty cell.
    assert.deepEqual(cuts(3, 4), ["RB", "--", "--"]);
    assert.deepEqual(cuts(1, 4), ["--"]);
    assert.deepEqual(cuts(2, 8), ["R-", "--"]);
    assert.deepEqual(cuts(5, 6), ["RB", "-B", "RB", "--", "--"]);
  });
});
