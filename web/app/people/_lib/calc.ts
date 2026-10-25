/**
 * Pay calculations, pure and unit-tested (see __tests__/calc.test.mjs).
 *
 * Business rules (decided; the brief overrides any older design text):
 * - Monthly: net = salary − (salary ÷ 30 × absent days) + overtime − TDS - a fixed 30,
 *   whatever the BS month's real length.
 *   Saturdays (weekly off) are paid. No half days, no leave.
 * - Daily:   net = wage × (present + overtime days) + overtime − TDS.
 * - Overtime: whole hours; amount = hours × hourly rate. The rate is per
 *   employee, default salary ÷ 30 ÷ 8 - always 30, whatever the BS month's
 *   length (daily: wage ÷ 8); editable on every salary revision.
 * - Advances are part-payments of that month's salary: nothing to recover,
 *   nothing carried over. due = net − payments of the month.
 * - No SSF. TDS is a 0 placeholder.
 *
 * Attendance comes ONLY from the AttendanceSummary contract (MonthSummary).
 */

import type { MonthStatus, MonthSummary, Payment, PayType } from "../types";

/** Whole rupees, half up. */
export function roundRs(value: number): number {
  return Math.round(value + Number.EPSILON);
}

/** Days a monthly salary is divided by - absence deduction and overtime rate alike: always 30, never the month's real length. */
export const PAY_DAYS = 30;
export const OT_DAYS = PAY_DAYS;

/** Default overtime rate: one hour of an 8-hour day (monthly: salary ÷ 30 ÷ 8). Whole rupees. */
export function defaultOtRate(pay_type: PayType, amount: number): number {
  if (pay_type === "daily") return roundRs(amount / 8);
  return roundRs(amount / OT_DAYS / 8);
}

export function overtimePay(hours: number, ot_rate: number): number {
  return roundRs(Math.max(0, Math.floor(hours)) * Math.max(0, ot_rate));
}

export interface PayResult {
  paid_days: number;
  gross_salary: number;
  overtime_pay: number;
  earnings: number;
  absence_deduction: number;
  tds: number;
  net: number;
}

/** Monthly salary: full salary, minus salary ÷ 30 × absent days, plus overtime. */
export function monthlyPay(salary: number, ot_rate: number, s: MonthSummary): PayResult {
  const days = s.days_in_month;
  const perDay = salary / PAY_DAYS;
  const absence = Math.min(roundRs(perDay * Math.max(0, s.absent)), roundRs(salary));
  const overtime = overtimePay(s.overtime_hours, ot_rate);
  const gross_salary = roundRs(salary);
  const tds = 0; // placeholder: tax rules are out of scope for now
  return {
    paid_days: Math.max(0, days - s.absent),
    gross_salary,
    overtime_pay: overtime,
    earnings: gross_salary + overtime,
    absence_deduction: absence,
    tds,
    net: roundRs(gross_salary - absence + overtime - tds),
  };
}

/** Daily wage: wage × (present + overtime days) plus overtime hours; nothing to deduct. */
export function dailyPay(wage: number, ot_rate: number, s: MonthSummary): PayResult {
  const worked = Math.max(0, s.present) + Math.max(0, s.overtime_days);
  const gross_salary = roundRs(wage * worked);
  const overtime = overtimePay(s.overtime_hours, ot_rate);
  const tds = 0;
  return {
    paid_days: worked,
    gross_salary,
    overtime_pay: overtime,
    earnings: gross_salary + overtime,
    absence_deduction: 0,
    tds,
    net: roundRs(gross_salary + overtime - tds),
  };
}

export function payFor(pay_type: PayType, rate: number, ot_rate: number, s: MonthSummary): PayResult {
  return pay_type === "monthly" ? monthlyPay(rate, ot_rate, s) : dailyPay(rate, ot_rate, s);
}

export interface PaidResult {
  salary_paid: number;
  advance_paid: number;
  paid: number;
  due: number;
  status: MonthStatus;
}

/** Payments against a month, split by type; due never negative. */
export function settle(net: number, payments: Pick<Payment, "type" | "amount">[]): PaidResult {
  const salary_paid = payments.filter((p) => p.type === "salary").reduce((s, p) => s + p.amount, 0);
  const advance_paid = payments.filter((p) => p.type === "advance").reduce((s, p) => s + p.amount, 0);
  const paid = salary_paid + advance_paid;
  const due = Math.max(0, roundRs(net - paid));
  return { salary_paid, advance_paid, paid, due, status: monthStatus(net, paid) };
}

/** Paid when nothing is due, part paid when something was paid, else pending. */
export function monthStatus(net: number, paid: number): MonthStatus {
  if (paid >= net && paid > 0) return "paid";
  if (net <= 0 && paid <= 0) return "paid";
  return paid > 0 ? "part_paid" : "pending";
}

/** Validation shared by the payment modal, the mock API and the scan pop-up. */
export function paymentError(amount: number, due: number): string | null {
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
    return "Enter an amount above 0.";
  }
  if (amount > due) return `More than the balance due (Rs ${due.toLocaleString("en-IN")}).`;
  return null;
}

/** Example for the Add-employee popup: 30-day month, 2 absent days, no overtime. */
export function monthlyExample(salary: number): number {
  return roundRs(salary - (salary / 30) * 2);
}

/** Example for the Add-employee popup: 26 days present, no overtime. */
export function dailyExample(wage: number): number {
  return roundRs(wage * 26);
}
