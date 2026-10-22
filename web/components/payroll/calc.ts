/**
 * Pay calculations, pure and unit-tested (see __tests__/calc.test.mjs).
 *
 * Rules (decided, do not change here without the brief):
 * - Monthly: pay = salary − (salary ÷ days in BS month × unpaid days).
 *   Leave and Saturdays are paid; a half day deducts ½ day; absent is unpaid.
 * - Daily: pay = wage × days present (half day counts ½); leave and absent
 *   unpaid.
 * - Advances are recovered from each payslip at the monthly recovery amount
 *   until cleared, never beyond what is left to pay.
 * - No allowances, SSF or tax yet; tds stays 0.
 *
 * Paid and unpaid days come from the AttendanceSummary contract (MonthSummary).
 */

import type { Advance, MonthSummary, PayType } from "./types";

/** Whole rupees, half up. */
export function roundRs(value: number): number {
  return Math.round(value + Number.EPSILON);
}

/** Unpaid days for monthly staff: absent days plus ½ per half day. */
export function unpaidDays(summary: MonthSummary): number {
  return Math.max(0, summary.days_in_month - summary.paid_days);
}

/** Days a daily-wage employee is paid for: present, half days as ½. */
export function daysWorked(summary: MonthSummary): number {
  return Math.max(0, summary.present);
}

export interface GrossResult {
  gross: number;
  absence_deduction: number;
  paid_days: number;
  unpaid_days: number;
}

/** Monthly salary: full salary, minus salary ÷ days in month × unpaid days. */
export function monthlyPay(salary: number, summary: MonthSummary): GrossResult {
  const unpaid = unpaidDays(summary);
  const days = summary.days_in_month;
  const deduction = days > 0 ? roundRs((salary / days) * unpaid) : 0;
  return {
    gross: roundRs(salary),
    absence_deduction: Math.min(deduction, roundRs(salary)),
    paid_days: days - unpaid,
    unpaid_days: unpaid,
  };
}

/** Daily wage: wage × days present (half days as ½); nothing to deduct. */
export function dailyPay(wage: number, summary: MonthSummary): GrossResult {
  const worked = daysWorked(summary);
  return {
    gross: roundRs(wage * worked),
    absence_deduction: 0,
    paid_days: worked,
    unpaid_days: 0,
  };
}

export function grossFor(
  pay_type: PayType,
  rate: number,
  summary: MonthSummary,
): GrossResult {
  return pay_type === "monthly" ? monthlyPay(rate, summary) : dailyPay(rate, summary);
}

export interface RecoveryPlanLine {
  advance_id: number;
  amount: number;
}

/**
 * How much to recover this month from each open advance, oldest first: the
 * monthly recovery, capped at what is still outstanding and at what the
 * payslip can still pay (`available`). Never negative, never beyond available.
 */
export function planRecoveries(
  advances: Advance[],
  available: number,
): RecoveryPlanLine[] {
  let left = Math.max(0, available);
  const plan: RecoveryPlanLine[] = [];
  const open = advances
    .filter((advance) => advance.outstanding > 0)
    .sort((a, b) => a.given_on.bs.localeCompare(b.given_on.bs) || a.id - b.id);
  for (const advance of open) {
    if (left <= 0) break;
    const amount = Math.min(advance.monthly_recovery, advance.outstanding, left);
    if (amount > 0) {
      plan.push({ advance_id: advance.id, amount: roundRs(amount) });
      left -= amount;
    }
  }
  return plan;
}

export function totalRecovery(plan: RecoveryPlanLine[]): number {
  return plan.reduce((sum, line) => sum + line.amount, 0);
}

export interface PayslipAmounts extends GrossResult {
  advance_recovered: number;
  tds: number;
  net_pay: number;
  recoveries: RecoveryPlanLine[];
}

/** Everything a payslip needs from the rate, the attendance and open advances. */
export function computePayslip(
  pay_type: PayType,
  rate: number,
  summary: MonthSummary,
  advances: Advance[],
): PayslipAmounts {
  const base = grossFor(pay_type, rate, summary);
  const beforeAdvance = base.gross - base.absence_deduction;
  const recoveries = planRecoveries(advances, beforeAdvance);
  const advance_recovered = totalRecovery(recoveries);
  const tds = 0; // placeholder: tax rules are out of scope for now
  return {
    ...base,
    advance_recovered,
    tds,
    net_pay: roundRs(beforeAdvance - advance_recovered - tds),
    recoveries,
  };
}

/** Example used in the Add-employee popup: 30-day month, 2 absent days. */
export function monthlyExample(salary: number): number {
  return roundRs(salary - (salary / 30) * 2);
}

/** Example used in the Add-employee popup: 26 days present. */
export function dailyExample(wage: number): number {
  return roundRs(wage * 26);
}

/**
 * Months until an advance clears at the monthly recovery (0 when cleared,
 * Infinity when nothing is being recovered).
 */
export function monthsToClear(outstanding: number, monthly_recovery: number): number {
  if (outstanding <= 0) return 0;
  if (monthly_recovery <= 0) return Number.POSITIVE_INFINITY;
  return Math.ceil(outstanding / monthly_recovery);
}
