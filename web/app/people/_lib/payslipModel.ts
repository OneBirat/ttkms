/**
 * The printed pay slip (design/payslips/PaySlipSheet4 / 6 / 8): the text of one slip per layout
 * and how the slips are laid out on A4 sheets. Pure, unit-tested (__tests__/payslipModel.test.ts).
 *
 * No salary maths here: every amount is formatted straight from GET /api/payroll/payslips.
 */

import { formatBs, monthName, parseBs } from "@/lib/bs";
import { formatAmount } from "./helpers";
import type { PerPage } from "./payslipSelection";
import type { Payslip, PayslipPayment, Payslips, UnpaidReason } from "../types";

export interface SlipLine {
  key: string;
  label: string;
  /** The small text after the label ("1 × 866.67"). */
  note: string;
  amount: string;
}

export interface SlipText {
  name: string;
  /** Under the name: "E-022 · Accounts assistant · Accounts" (8-up: code · department · paid days). */
  sub: string;
  /** "26/30" */
  paidDays: string;
  /** "3 h" */
  overtimeHours: string;
  /** The Absent days and their dates ("2 days", "Kartik 7, 21"); null when there is no absence. */
  absent: { days: string; dates: string } | null;
  /** 6-up: "Paid days 26/30 · Absent 2 · Overtime 3 h". */
  attendanceLine: string;
  base: SlipLine;
  /** One line per reason with unpaid days; empty when nothing was deducted. */
  deductions: SlipLine[];
  overtime: SlipLine;
  /** "Earned this month" (4-up and 6-up). */
  earned: string;
  /** 4-up: one line per payment (collapsed into one when there are many); 6 / 8-up: one line. */
  payments: SlipLine[];
  /** "Rs 12,345" */
  balance: string;
}

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
const minus = (n: number) => (n > 0 ? `−${formatAmount(n)}` : "0");
const plus = (n: number) => (n > 0 ? `+${formatAmount(n)}` : "0");

/** 866.67 -> "866.67", 1000 -> "1,000", 1166.5 -> "1,166.50" (Indian grouping). */
export function formatRate(value: number): string {
  const paisa = Math.round(value * 100);
  const whole = Math.floor(paisa / 100);
  const rest = paisa - whole * 100;
  return rest === 0 ? formatAmount(whole) : `${formatAmount(whole)}.${String(rest).padStart(2, "0")}`;
}

/** "Kartik 7, 21": the month name once, then the day numbers (dates of one BS month, ascending). */
export function absentDatesText(dates: string[]): string {
  const parts = dates.map(parseBs).filter((p): p is NonNullable<typeof p> => p !== null);
  if (parts.length === 0) return "";
  return `${monthName(parts[0].month)} ${parts.map((p) => p.day).join(", ")}`;
}

const REASON_LABEL: Record<UnpaidReason, string> = {
  absent: "Absence",
  not_marked: "Not marked",
  after_leaving: "After leaving",
  unpaid_holiday: "Unpaid holiday",
};

/** 4-up: a slip has room for this many amount lines above Balance due. */
export const LINES_4UP = 9;
/** 4-up: more payments than this are printed as one line with the total. */
export const PAYMENTS_LISTED = 5;

const paymentLabel = (p: PayslipPayment) => (p.kind === "advance" ? "Advance" : "Salary paid");

/** "Advances" when every payment is an advance, "Paid" as soon as a salary payment is among them. */
function paymentsLabel(payments: PayslipPayment[]): string {
  return payments.some((p) => p.kind !== "advance") ? "Paid" : "Advances";
}

function paymentLines(slip: Payslip, layout: PerPage, linesBefore: number): SlipLine[] {
  const list = slip.advances;
  const n = list.length;
  const total = minus(slip.advances_total);
  if (layout === 8) {
    return [{ key: "payments", label: paymentsLabel(list), note: n ? `× ${n}` : "none", amount: total }];
  }
  if (layout === 6) {
    return [{ key: "payments", label: paymentsLabel(list), note: n ? `${n} ${n === 1 ? "payment" : "payments"}` : "none", amount: total }];
  }
  if (n === 0) return [{ key: "payments", label: "Advance", note: "none this month", amount: "0" }];
  if (n > PAYMENTS_LISTED || linesBefore + n > LINES_4UP) {
    return [{ key: "payments", label: paymentsLabel(list), note: `${n} payments`, amount: total }];
  }
  return list.map((p, i) => ({
    key: `payment-${i}`,
    label: paymentLabel(p),
    note: `${formatBs(p.date.bs, "%B %-d")} · ${p.mode}`,
    amount: minus(p.amount),
  }));
}

export function slipText(slip: Payslip, layout: PerPage): SlipText {
  const e = slip.employee;
  const monthly = e.pay_type === "monthly";
  const paidDays = `${slip.paid_days}/${slip.month.days_in_month}`;
  const overtimeHours = `${slip.overtime_hours} h`;
  const dash = (text: string | null) => text ?? "—";

  const base: SlipLine = monthly
    ? {
        key: "base",
        label: layout === 8 ? "Salary" : "Monthly salary",
        // The running month pays the days so far (salary × days ÷ 30): say so.
        note: slip.in_progress ? `${Math.min(slip.days_counted, 30)} of 30 days so far` : "",
        amount: formatAmount(slip.base_amount),
      }
    : { key: "base", label: "Wage", note: `${days(slip.paid_days)} × ${formatRate(e.rate)}`, amount: formatAmount(slip.base_amount) };

  // HIDDEN when nothing was deducted: no line at all for a reason without days.
  const deductions: SlipLine[] = slip.deductions
    .filter((d) => d.days > 0)
    .map((d) => ({
      key: d.reason,
      label: REASON_LABEL[d.reason],
      note: layout === 8 ? days(d.days) : `${d.days} × ${formatRate(slip.day_rate)}`,
      amount: minus(d.amount),
    }));

  const overtime: SlipLine = {
    key: "overtime",
    label: "Overtime",
    note: layout === 8 ? overtimeHours : `${overtimeHours} × ${formatRate(slip.overtime_rate)}`,
    amount: plus(slip.overtime_amount),
  };

  // 4-up lines above the payments: base, the deductions, overtime, earned.
  const linesBefore = 3 + deductions.length;
  return {
    name: e.name,
    sub: layout === 8 ? [e.code, dash(e.department), `paid days ${paidDays}`].join(" · ") : [e.code, dash(e.role), dash(e.department)].join(" · "),
    paidDays,
    overtimeHours,
    absent: slip.absent_days > 0 ? { days: days(slip.absent_days), dates: absentDatesText(slip.absent_dates) } : null,
    attendanceLine: [`Paid days ${paidDays}`, slip.absent_days > 0 ? `Absent ${slip.absent_days}` : null, `Overtime ${overtimeHours}`].filter(Boolean).join(" · "),
    base,
    deductions,
    overtime,
    earned: formatAmount(slip.earned),
    payments: paymentLines(slip, layout, linesBefore),
    balance: `Rs ${formatAmount(slip.balance_due)}`,
  };
}

// ---------------------------------------------------------------------------- sheets

export interface SlipCopy {
  slip: Payslip;
  /** The second copy of an employee ("Office copy" in the header line). */
  office: boolean;
}

export interface SheetCell extends SlipCopy {
  /** Dashed cut lines: only towards a neighbour that holds a slip, never on the outer edge. */
  cutRight: boolean;
  cutBelow: boolean;
}

/** The slips in print order; with the office copy, each employee's two copies sit side by side. */
export function slipCopies(slips: Payslip[], officeCopy: boolean): SlipCopy[] {
  return slips.flatMap((slip) => (officeCopy ? [{ slip, office: false }, { slip, office: true }] : [{ slip, office: false }]));
}

/** A4 sheets of `perPage` cells, 2 columns; the last sheet may be partly empty. */
export function sheetsOf(copies: SlipCopy[], perPage: PerPage): SheetCell[][] {
  const sheets: SheetCell[][] = [];
  for (let start = 0; start < copies.length; start += perPage) {
    const cells = copies.slice(start, start + perPage);
    sheets.push(
      cells.map((copy, i) => ({
        ...copy,
        cutRight: i % 2 === 0 && i + 1 < cells.length,
        cutBelow: i + 2 < cells.length,
      })),
    );
  }
  return sheets;
}

// ---------------------------------------------------------------------------- header texts

export interface SheetTexts {
  /** "TTK · Main branch" */
  place: string;
  /** "TTK" */
  business: string;
  /** "Kartik 2083" */
  month: string;
  /** "Printed Kartik 26, 2083" */
  printed: string;
}

export function sheetTexts(data: Pick<Payslips, "business" | "branch" | "month" | "today">): SheetTexts {
  return {
    place: `${data.business} · ${data.branch.name}`,
    business: data.business,
    month: `${monthName(data.month.bs_month)} ${data.month.bs_year}`,
    printed: `Printed ${formatBs(data.today.bs)}`,
  };
}

/** The print page's query string: ids (order kept, repeats dropped), office copy, auto-print. */
export function parseIds(value: string | null): number[] {
  const out: number[] = [];
  for (const part of (value ?? "").split(",")) {
    const n = Number(part);
    if (part.trim() !== "" && Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}
