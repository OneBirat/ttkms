import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { absencePerDay, monthDetailRows } from "../_lib/monthDetail";
import type { MonthLedger } from "../types";

function ledger(over: Partial<MonthLedger> = {}, attendance: Partial<MonthLedger["attendance"]> = {}): MonthLedger {
  return {
    employee_id: 1,
    month: { bs_year: 2083, bs_month: 6 },
    in_progress: false,
    pay_type: "monthly",
    rate: 24000,
    ot_rate: 100,
    attendance: { days_in_month: 31, present: 28, overtime_days: 2, overtime_hours: 6, absent: 1, weekly_off: 4, paid_days: 30, saturday_ot_hours: 0, ...attendance },
    paid_days: 30,
    gross_salary: 24000,
    overtime_pay: 600,
    earnings: 24600,
    absence_deduction: 800,
    tds: 0,
    net: 23800,
    salary_paid: 20000,
    advance_paid: 1000,
    paid: 21000,
    due: 2800,
    status: "part_paid",
    payments: [],
    ...over,
  } as unknown as MonthLedger;
}

const flat = (l: MonthLedger) =>
  monthDetailRows(l).map((r) => (r.kind === "section" ? `# ${r.label}` : [r.kind, r.label, r.qty, r.rate, r.amount].join(" | ")));

describe("salary tab month detail: one table", () => {
  it("earnings, deductions, net, paid and due (no attendance, no TDS)", () => {
    assert.deepEqual(flat(ledger()), [
      "# Earnings",
      "line | Monthly salary |  |  | 24,000",
      "line | Overtime | 6 h | 100 / h | +600",
      "total | Total earnings |  |  | 24,600",
      "# Deductions",
      "line | Absence | 1 day | 800 / day | −800",
      "net | Net salary |  |  | 23,800",
      "paid | Paid (salary + advances) |  |  | −21,000",
      "due | Due |  |  | 2,800",
    ]);
    assert.doesNotMatch(JSON.stringify(monthDetailRows(ledger())), /TDS|Attendance|Present|Weekly off/i);
  });

  it("due: orange while owing, green when cleared", () => {
    const owing = monthDetailRows(ledger()).at(-1)!;
    assert.equal(owing.kind === "due" && owing.owing, true);
    const done = monthDetailRows(ledger({ paid: 23800, due: 0 })).at(-1)!;
    assert.equal(done.kind === "due" && done.owing, false);
  });

  it("daily wage: days × wage, absences not paid; Saturday overtime counted in hours", () => {
    const rows = flat(ledger({ pay_type: "daily", rate: 800, paid_days: 20, gross_salary: 16000, absence_deduction: 0 }, { saturday_ot_hours: 2 }));
    assert.equal(rows[1], "line | Daily wage | 20 days | 800 / day | 16,000");
    assert.equal(rows[2], "line | Overtime | 8 h | 100 / h | +600");
    assert.equal(rows[5], "line | Absence | 1 day | not paid | 0");
  });

  it("per absent day = what was deducted ÷ absent days, else salary ÷ 30", () => {
    assert.equal(absencePerDay(ledger({ absence_deduction: 1600 }, { absent: 2 })), 800);
    assert.equal(absencePerDay(ledger({ absence_deduction: 0 }, { absent: 0 })), 800);
  });
});
