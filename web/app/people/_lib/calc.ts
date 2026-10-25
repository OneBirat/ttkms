/**
 * Pay calculations, pure and unit-tested (see __tests__/calc.test.mjs).
 *
 * Business rules (decided; the brief overrides any older design text):
 * - Monthly: net = salary − (salary ÷ 30 × absent days) + overtime − TDS - a fixed 30,
 *   whatever the BS month's real length.
 *   Saturdays (weekly off) are paid. No half days, no leave.
 * - Running month ("earned so far"): salary × min(days_counted, 30) ÷ 30, then absences and
 *   overtime so far as above. Past months are never prorated.
 * - Saturday work (PENDING DECISION, payroll.saturday_work_rule): monthly staff get the hours
 *   ("overtime_only") or also salary ÷ 30 per Saturday worked ("extra_day", inside gross).
 *   Daily staff always get the day's wage plus the hours.
 * - Daily:   net = wage × (present + overtime days + Saturdays worked) + overtime − TDS.
 * - Overtime: whole hours; amount = hours × hourly rate. The rate is per
 *   employee, default salary ÷ 30 ÷ 8 - always 30, whatever the BS month's
 *   length (daily: wage ÷ 8); editable on every salary revision.
 * - Advances are part-payments of that month's salary: nothing to recover,
 *   nothing carried over. due = net − payments of the month.
 * - No SSF. TDS is a 0 placeholder.
 *
 * Attendance comes ONLY from the AttendanceSummary contract (MonthSummary).
 */

import type { MonthStatus, MonthSummary, Payment, PayType, SaturdayWorkRule } from "../types";

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
  /** Monthly with "extra_day": salary ÷ 30 × Saturdays worked, already inside gross_salary. */
  saturday_pay: number;
}

export interface PayOptions {
  /** The running month: prorate the salary by days_counted (capped at 30). */
  so_far?: boolean;
  saturday_rule?: SaturdayWorkRule;
}

/** Monthly salary: full salary (prorated so far), minus salary ÷ 30 × absent days, plus overtime. */
export function monthlyPay(salary: number, ot_rate: number, s: MonthSummary, options: PayOptions = {}): PayResult {
  const counted = s.days_counted ?? s.days_in_month;
  const perDay = salary / PAY_DAYS;
  const base = roundRs(options.so_far ? (salary * Math.min(Math.max(0, counted), PAY_DAYS)) / PAY_DAYS : salary);
  const absence = Math.min(roundRs(perDay * Math.max(0, s.absent)), base);
  const overtime = overtimePay(s.overtime_hours + (s.saturday_ot_hours ?? 0), ot_rate);
  const saturday_pay =
    options.saturday_rule === "extra_day" ? roundRs(perDay * Math.max(0, s.saturday_days_worked ?? 0)) : 0;
  const gross_salary = base + saturday_pay;
  const tds = 0; // placeholder: tax rules are out of scope for now
  return {
    paid_days: Math.max(0, (options.so_far ? counted : s.days_in_month) - s.absent),
    gross_salary,
    overtime_pay: overtime,
    earnings: gross_salary + overtime,
    absence_deduction: absence,
    tds,
    net: roundRs(gross_salary - absence + overtime - tds),
    saturday_pay,
  };
}

/** Daily wage: wage × (present + overtime days + Saturdays worked) plus overtime hours; nothing to deduct. */
export function dailyPay(wage: number, ot_rate: number, s: MonthSummary): PayResult {
  const worked = Math.max(0, s.present) + Math.max(0, s.overtime_days) + Math.max(0, s.saturday_days_worked ?? 0);
  const gross_salary = roundRs(wage * worked);
  const overtime = overtimePay(s.overtime_hours + (s.saturday_ot_hours ?? 0), ot_rate);
  const tds = 0;
  return {
    paid_days: worked,
    gross_salary,
    overtime_pay: overtime,
    earnings: gross_salary + overtime,
    absence_deduction: 0,
    tds,
    net: roundRs(gross_salary + overtime - tds),
    saturday_pay: 0,
  };
}

export function payFor(pay_type: PayType, rate: number, ot_rate: number, s: MonthSummary, options: PayOptions = {}): PayResult {
  return pay_type === "monthly" ? monthlyPay(rate, ot_rate, s, options) : dailyPay(rate, ot_rate, s);
}

export interface PaidResult {
  salary_paid: number;
  advance_paid: number;
  paid: number;
  due: number;
  status: MonthStatus;
}

/** Payments against a month, split by type; due never negative. */
export function settle(net: number, payments: Pick<Payment, "kind" | "amount">[]): PaidResult {
  const salary_paid = payments.filter((p) => p.kind === "salary").reduce((s, p) => s + p.amount, 0);
  const advance_paid = payments.filter((p) => p.kind === "advance").reduce((s, p) => s + p.amount, 0);
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
