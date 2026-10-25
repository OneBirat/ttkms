import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dailyExample,
  dailyPay,
  defaultOtRate,
  monthStatus,
  monthlyExample,
  monthlyPay,
  overtimePay,
  payFor,
  paymentError,
  roundRs,
  settle,
} from "../_lib/calc.ts";

/** A full 30-day month: 4 Saturdays, 26 working days. */
function summary(overrides = {}) {
  return {
    days_in_month: 30,
    present: 26,
    overtime_days: 0,
    overtime_hours: 0,
    absent: 0,
    weekly_off: 4,
    paid_days: 30,
    ...overrides,
  };
}

test("monthly: a full month pays the full salary; Saturdays are paid", () => {
  const r = monthlyPay(30000, 125, summary());
  assert.equal(r.gross_salary, 30000);
  assert.equal(r.absence_deduction, 0);
  assert.equal(r.net, 30000);
  assert.equal(r.paid_days, 30);
});

test("monthly: absent days deduct salary ÷ days in month × absent", () => {
  const r = monthlyPay(30000, 125, summary({ present: 24, absent: 2, paid_days: 28 }));
  assert.equal(r.absence_deduction, 2000);
  assert.equal(r.net, 28000);
  assert.equal(r.paid_days, 28);
});

test("monthly: overtime adds hours × rate; overtime days alone add nothing", () => {
  const r = monthlyPay(30000, 125, summary({ overtime_days: 1, overtime_hours: 6 }));
  assert.equal(r.overtime_pay, 750);
  assert.equal(r.earnings, 30750);
  assert.equal(r.net, 30750);
});

test("monthly: uses the real days in the BS month (32-day Ashadh)", () => {
  const r = monthlyPay(32000, 125, summary({ days_in_month: 32, absent: 1, paid_days: 31 }));
  assert.equal(r.absence_deduction, 1000);
});

test("monthly: deduction never exceeds the salary", () => {
  const r = monthlyPay(30000, 125, summary({ absent: 40, present: 0 }));
  assert.equal(r.absence_deduction, 30000);
  assert.equal(r.net, 0);
});

test("daily: wage × (present + overtime days) plus overtime hours; nothing deducted", () => {
  const r = dailyPay(650, 80, summary({ present: 24, overtime_days: 1, overtime_hours: 3, absent: 2 }));
  assert.equal(r.paid_days, 25);
  assert.equal(r.gross_salary, 16250);
  assert.equal(r.overtime_pay, 240);
  assert.equal(r.absence_deduction, 0);
  assert.equal(r.net, 16490);
});

test("payFor dispatches on pay type", () => {
  assert.equal(payFor("monthly", 30000, 125, summary()).net, 30000);
  assert.equal(payFor("daily", 650, 80, summary()).net, 16900);
});

test("overtime: whole hours only, never negative", () => {
  assert.equal(overtimePay(2.9, 100), 200);
  assert.equal(overtimePay(-1, 100), 0);
  assert.equal(overtimePay(3, -5), 0);
});

test("default overtime rate = salary ÷ 30 ÷ 8 whatever the month length (daily: wage ÷ 8), whole rupees", () => {
  assert.equal(defaultOtRate("monthly", 24000), 100);
  assert.equal(defaultOtRate("monthly", 22000), 92);
  assert.equal(defaultOtRate("daily", 650), 81);
  // Ashadh (32 days) and Mangsir (29 days) pay the same overtime hour.
  const rate = defaultOtRate("monthly", 24000);
  const long = monthlyPay(24000, rate, { days_in_month: 32, present: 28, overtime_days: 2, overtime_hours: 4, absent: 0, weekly_off: 2, paid_days: 32 });
  const short = monthlyPay(24000, rate, { days_in_month: 29, present: 25, overtime_days: 2, overtime_hours: 4, absent: 0, weekly_off: 2, paid_days: 29 });
  assert.equal(long.overtime_pay, 400);
  assert.equal(short.overtime_pay, 400);
});

test("rounding is to whole rupees, half up", () => {
  assert.equal(roundRs(10.5), 11);
  assert.equal(roundRs(10.49), 10);
  assert.equal(monthlyPay(10000, 0, summary({ absent: 1 })).absence_deduction, 333);
});

test("settle: advances and salary payments both reduce the due; status follows", () => {
  const s = settle(20000, [
    { type: "advance", amount: 1500 },
    { type: "salary", amount: 10000 },
  ]);
  assert.equal(s.advance_paid, 1500);
  assert.equal(s.salary_paid, 10000);
  assert.equal(s.paid, 11500);
  assert.equal(s.due, 8500);
  assert.equal(s.status, "part_paid");
  assert.equal(settle(20000, []).status, "pending");
  assert.equal(settle(20000, [{ type: "salary", amount: 20000 }]).status, "paid");
  assert.equal(settle(20000, [{ type: "salary", amount: 25000 }]).due, 0);
});

test("month status: nothing earned and nothing paid counts as paid (nothing due)", () => {
  assert.equal(monthStatus(0, 0), "paid");
  assert.equal(monthStatus(100, 0), "pending");
});

test("payment validation: above 0 and not above the due", () => {
  assert.equal(paymentError(500, 8500), null);
  assert.equal(paymentError(8500, 8500), null);
  assert.equal(paymentError(0, 8500), "Enter an amount above 0.");
  assert.equal(paymentError(-5, 8500), "Enter an amount above 0.");
  assert.equal(paymentError(10.5, 8500), "Enter an amount above 0.");
  assert.equal(paymentError(8501, 8500), "More than the balance due (Rs 8,500).");
});

test("popup examples match the rule text", () => {
  assert.equal(monthlyExample(30000), 28000);
  assert.equal(dailyExample(650), 16900);
});
