/**
 * Pay salary (design ui-touch/EmployeesPaySalary.dc.html): ONE amount settles the salary due,
 * oldest month first. The server (POST /api/payroll/salary-payments) does the real split; these
 * rules drive the live preview, the quick amounts and the texts. Tested in
 * __tests__/settle.test.mjs.
 */

import { formatBs } from "@/lib/bs";
import { STATUS_LABEL, formatAmount, formatRs } from "./helpers";
import { monthName } from "./months";
import type { BsMonth, MonthLedger, Payment, SalaryDueMonth, SalaryDues, SalaryPaymentResult } from "../types";

export interface Allocation {
  month: SalaryDueMonth;
  amount: number;
  /** The month's due before this payment. */
  due: number;
  /** The month is cleared by it. */
  full: boolean;
}

/** `amount` over the months' dues, oldest first; months with nothing due are skipped. */
export function allocate(amount: number, months: readonly SalaryDueMonth[]): Allocation[] {
  let left = Math.max(0, Math.floor(amount));
  const out: Allocation[] = [];
  for (const month of months) {
    if (left <= 0) break;
    if (month.due <= 0) continue;
    const part = Math.min(left, month.due);
    out.push({ month, amount: part, due: month.due, full: part === month.due });
    left -= part;
  }
  return out;
}

/** The amount the dialog opens with: everything due for past months, else the total. */
export function defaultAmount(dues: SalaryDues): number {
  return dues.past_due || dues.total_due;
}

export interface QuickAmount {
  label: string;
  value: number;
}

/** "All past months 21,240" · "Everything incl. Kartik 28,417" · 5,000 · 10,000 - only those that fit. */
export function quickAmounts(dues: SalaryDues): QuickAmount[] {
  const running = monthName(dues.running_month);
  const all: QuickAmount[] = [
    { label: `All past months ${formatAmount(dues.past_due)}`, value: dues.past_due },
    { label: `Everything incl. ${running} ${formatAmount(dues.total_due)}`, value: dues.total_due },
    { label: "5,000", value: 5000 },
    { label: "10,000", value: 10000 },
  ];
  return all.filter((q, i) => q.value > 0 && q.value <= dues.total_due && !(i === 1 && dues.total_due === dues.past_due));
}

/** Shown under the amount (red border, Save disabled) when it is above the total due. */
export function overMessage(dues: SalaryDues): string {
  return `More than the total due (${formatRs(dues.total_due)}). ${monthName(dues.running_month)} can only be paid up to what is earned so far.`;
}

/** Under the month in the dues table: "31 days · 2 absent" / "running · earned so far". */
export function dueMonthSub(month: SalaryDueMonth): string {
  if (month.in_progress) return "running · earned so far";
  return `${month.days_in_month} days · ${month.absent} absent`;
}

/** "Cleared Kartik 8" from a BS date. */
export function clearedText(bs: string): string {
  return `Cleared ${formatBs(bs, "%B %-d")}`;
}

/** A month's status for the salary ledger / Salary report: "Cleared Kartik 8" once nothing is due. */
export function monthStatusText(ledger: Pick<MonthLedger, "status" | "due" | "cleared_on">): string {
  return ledger.due === 0 && ledger.cleared_on ? clearedText(ledger.cleared_on.bs) : STATUS_LABEL[ledger.status];
}

/** A dues-table month with nothing left: its cleared date, or (nothing earned yet) a dash. */
export function settledText(month: SalaryDueMonth): string {
  return month.cleared_on ? clearedText(month.cleared_on.bs) : "Nothing due";
}

/** "This payment covers" pill: "Cleared Kartik 8" (today) or "Rs 2,000 left". */
export function coverState(a: Allocation, todayBs: string): string {
  return a.full ? clearedText(todayBs) : `${formatRs(a.due - a.amount)} left`;
}

/** Done-state chips: "Bhadra Rs 3,000 · cleared Kartik 8" / "Ashoj Rs 5,000". */
export function splitChips(result: SalaryPaymentResult): { text: string; cleared: boolean }[] {
  return result.split.map((s) => ({
    text: `${monthName(s.month)} ${formatRs(s.amount)}${s.cleared_on ? ` · cleared ${formatBs(s.cleared_on.bs, "%B %-d")}` : ""}`,
    cleared: Boolean(s.cleared_on),
  }));
}

/** Under the chips: "Nothing due now · all cleared Kartik 8" or "Still due: Rs 5,000". */
export function afterText(result: SalaryPaymentResult): string {
  return result.total_due_after === 0
    ? `Nothing due now · all cleared ${formatBs(result.date.bs, "%B %-d")}`
    : `Still due: ${formatRs(result.total_due_after)}`;
}

/** A payment as one entry: a salary payment group's rows (one per month) become one. */
export interface PaymentEntry {
  /** The group's first row (oldest month); `amount` is the group's total. */
  payment: Payment;
  /** Months covered, oldest first. */
  months: BsMonth[];
  /** Every row id of the entry. */
  ids: number[];
}

/** Groups (same payment_group_id) folded into one entry, kept in the order of their first row. */
export function paymentEntries(payments: readonly Payment[]): PaymentEntry[] {
  const out: PaymentEntry[] = [];
  const byGroup = new Map<number, PaymentEntry>();
  for (const p of payments) {
    const group = p.payment_group_id ?? null;
    const seen = group === null ? undefined : byGroup.get(group);
    if (seen) {
      seen.payment = { ...seen.payment, amount: seen.payment.amount + p.amount };
      seen.months.push(p.month);
      seen.ids.push(p.id);
      continue;
    }
    const entry: PaymentEntry = { payment: { ...p }, months: [p.month], ids: [p.id] };
    if (group !== null) byGroup.set(group, entry);
    out.push(entry);
  }
  for (const e of out) {
    e.months.sort((a, b) => a.bs_year - b.bs_year || a.bs_month - b.bs_month);
  }
  return out;
}

/** "Kartik" / "Bhadra – Ashwin" (the entry's months, short). */
export function monthsText(months: readonly BsMonth[], label: (m: BsMonth) => string = monthName): string {
  if (months.length === 0) return "";
  if (months.length === 1) return label(months[0]);
  return `${label(months[0])} – ${label(months[months.length - 1])}`;
}

/** Digits only, as typed into the amount box ("Rs 1,500" → 1500; "" → 0). */
export function parseTyped(value: string): number {
  const digits = value.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}
