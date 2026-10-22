import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computePayslip,
  dailyExample,
  dailyPay,
  daysWorked,
  monthlyExample,
  monthlyPay,
  monthsToClear,
  planRecoveries,
  roundRs,
  unpaidDays,
} from "../calc.ts";

const summary = (over = {}) => ({
  days_in_month: 30,
  present: 24,
  late: 1,
  half_days: 0,
  leave: 1,
  absent: 0,
  weekly_off: 5,
  paid_days: 30,
  ...over,
});

const advance = (over = {}) => ({
  id: 1,
  employee_id: 1,
  amount: 10000,
  given_on: { bs: "2083-04-10", ad: "2026-07-26" },
  monthly_recovery: 2500,
  note: null,
  recoveries: [],
  outstanding: 5000,
  ...over,
});

test("monthly: full month pays the full salary; leave and Saturdays are paid", () => {
  const result = monthlyPay(22000, summary({ leave: 2, weekly_off: 4, paid_days: 30 }));
  assert.equal(result.gross, 22000);
  assert.equal(result.absence_deduction, 0);
  assert.equal(result.paid_days, 30);
  assert.equal(result.unpaid_days, 0);
});

test("monthly: absent days deduct salary ÷ days in month × unpaid", () => {
  const result = monthlyPay(22000, summary({ absent: 2, paid_days: 28 }));
  assert.equal(result.unpaid_days, 2);
  assert.equal(result.absence_deduction, 1467); // 22000/30*2 = 1466.67
  assert.equal(result.gross, 22000);
});

test("monthly: a half day deducts half a day", () => {
  const result = monthlyPay(30000, summary({ half_days: 1, paid_days: 29.5 }));
  assert.equal(result.unpaid_days, 0.5);
  assert.equal(result.absence_deduction, 500);
  assert.equal(result.paid_days, 29.5);
});

test("monthly: uses the real days in the BS month (32-day Ashadh)", () => {
  const result = monthlyPay(32000, summary({ days_in_month: 32, absent: 1, paid_days: 31 }));
  assert.equal(result.absence_deduction, 1000);
});

test("monthly: deduction never exceeds the salary", () => {
  const result = monthlyPay(10000, summary({ absent: 30, paid_days: 0 }));
  assert.equal(result.absence_deduction, 10000);
});

test("daily: wage × days present, half days count ½, leave and absent unpaid", () => {
  const result = dailyPay(600, summary({ present: 23.5, half_days: 1, leave: 2, absent: 1 }));
  assert.equal(result.gross, 14100);
  assert.equal(result.absence_deduction, 0);
  assert.equal(result.paid_days, 23.5);
  assert.equal(result.unpaid_days, 0);
});

test("unpaidDays and daysWorked come from the contract fields", () => {
  assert.equal(unpaidDays(summary({ paid_days: 27.5 })), 2.5);
  assert.equal(unpaidDays(summary({ paid_days: 31 })), 0);
  assert.equal(daysWorked(summary({ present: 20.5 })), 20.5);
  assert.equal(daysWorked(summary({ present: -1 })), 0);
});

test("rounding is to whole rupees, half up", () => {
  assert.equal(roundRs(1466.5), 1467);
  assert.equal(roundRs(1466.49), 1466);
  assert.equal(roundRs(0.5), 1);
  assert.equal(roundRs(2.5), 3);
});

test("advance recovery takes the monthly amount until cleared", () => {
  const plan = planRecoveries([advance()], 20000);
  assert.deepEqual(plan, [{ advance_id: 1, amount: 2500 }]);
});

test("advance recovery is capped at the outstanding balance", () => {
  const plan = planRecoveries([advance({ outstanding: 1200 })], 20000);
  assert.deepEqual(plan, [{ advance_id: 1, amount: 1200 }]);
});

test("advance recovery never exceeds what the payslip can pay", () => {
  const plan = planRecoveries([advance({ monthly_recovery: 9000, outstanding: 9000 })], 3100);
  assert.deepEqual(plan, [{ advance_id: 1, amount: 3100 }]);
  assert.deepEqual(planRecoveries([advance()], 0), []);
  assert.deepEqual(planRecoveries([advance()], -50), []);
});

test("several advances recover oldest first and share the available net", () => {
  const older = advance({ id: 2, given_on: { bs: "2083-03-01", ad: "" }, monthly_recovery: 2000, outstanding: 2000 });
  const newer = advance({ id: 3, given_on: { bs: "2083-05-01", ad: "" }, monthly_recovery: 3000, outstanding: 6000 });
  assert.deepEqual(planRecoveries([newer, older], 4000), [
    { advance_id: 2, amount: 2000 },
    { advance_id: 3, amount: 2000 },
  ]);
});

test("cleared advances are skipped", () => {
  assert.deepEqual(planRecoveries([advance({ outstanding: 0 })], 10000), []);
});

test("computePayslip: monthly with absence and an advance", () => {
  const slip = computePayslip("monthly", 22000, summary({ absent: 1, half_days: 1, paid_days: 28.5 }), [advance()]);
  assert.equal(slip.gross, 22000);
  assert.equal(slip.absence_deduction, 1100); // 22000/30*1.5
  assert.equal(slip.advance_recovered, 2500);
  assert.equal(slip.tds, 0);
  assert.equal(slip.net_pay, 22000 - 1100 - 2500);
});

test("computePayslip: daily wage, net never below zero", () => {
  const slip = computePayslip("daily", 550, summary({ present: 2 }), [advance({ monthly_recovery: 5000 })]);
  assert.equal(slip.gross, 1100);
  assert.equal(slip.advance_recovered, 1100);
  assert.equal(slip.net_pay, 0);
});

test("popup examples match the rule text", () => {
  assert.equal(monthlyExample(22000), 20533); // 22000 - 22000/30*2
  assert.equal(dailyExample(800), 20800);
});

test("monthsToClear", () => {
  assert.equal(monthsToClear(5000, 2500), 2);
  assert.equal(monthsToClear(5001, 2500), 3);
  assert.equal(monthsToClear(0, 2500), 0);
  assert.equal(monthsToClear(100, 0), Number.POSITIVE_INFINITY);
});
