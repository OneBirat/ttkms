/**
 * Salary tab · expanded month (ledger-touch item 2): one table instead of the Attendance /
 * Earnings / Deductions boxes - Description · Days / hours · Rate (Rs) · Amount (Rs), an Earnings
 * and a Deductions section, then Net salary, Paid (salary + advances) and Due. No attendance
 * section, no TDS.
 */

import { formatAmount } from "./helpers";
import type { MonthLedger, ReportTotals } from "../types";

export type MonthDetailRow =
  | { kind: "section"; label: string }
  | {
      kind: "line" | "total" | "net" | "paid" | "due";
      label: string;
      qty: string;
      rate: string;
      amount: string;
      /** "due" rows: something is still to pay (orange) or nothing (green). */
      owing?: boolean;
      /** The "Not marked" deduction: red. */
      danger?: boolean;
    };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Per unpaid day (absent or not marked): what was actually deducted ÷ those days (salary ÷ 30 when none). */
export function absencePerDay(l: Pick<MonthLedger, "rate" | "absence_deduction" | "attendance">): number {
  const unpaid = l.attendance.absent + (l.attendance.not_marked ?? 0);
  return unpaid > 0 ? Math.round(l.absence_deduction / unpaid) : Math.round(l.rate / 30);
}

/** The deduction split between absent and not marked days (they add up to absence_deduction). */
export function deductionSplit(l: Pick<MonthLedger, "absence_deduction" | "attendance">): { absent: number; not_marked: number } {
  const notMarked = l.attendance.not_marked ?? 0;
  const unpaid = l.attendance.absent + notMarked;
  if (unpaid <= 0 || notMarked <= 0) return { absent: l.absence_deduction, not_marked: 0 };
  const part = Math.round((l.absence_deduction * notMarked) / unpaid);
  return { absent: l.absence_deduction - part, not_marked: part };
}

export function monthDetailRows(l: MonthLedger): MonthDetailRow[] {
  const a = l.attendance;
  const otHours = a.overtime_hours + (a.saturday_ot_hours ?? 0);
  const rows: MonthDetailRow[] = [{ kind: "section", label: "Earnings" }];
  rows.push(
    l.pay_type === "monthly"
      ? { kind: "line", label: "Monthly salary", qty: "", rate: "", amount: formatAmount(l.gross_salary) }
      : {
          kind: "line",
          label: "Daily wage",
          qty: plural(l.paid_days, "day"),
          rate: `${formatAmount(l.rate)} / day`,
          amount: formatAmount(l.gross_salary),
        },
  );
  rows.push({
    kind: "line",
    label: "Overtime",
    qty: `${otHours} h`,
    rate: `${formatAmount(l.ot_rate)} / h`,
    amount: l.overtime_pay > 0 ? `+${formatAmount(l.overtime_pay)}` : "0",
  });
  rows.push({ kind: "total", label: "Total earnings", qty: "", rate: "", amount: formatAmount(l.earnings) });
  rows.push({ kind: "section", label: "Deductions" });
  const notMarked = a.not_marked ?? 0;
  const split = deductionSplit(l);
  rows.push(
    l.pay_type === "monthly"
      ? {
          kind: "line",
          label: "Absence",
          qty: plural(a.absent, "day"),
          rate: `${formatAmount(absencePerDay(l))} / day`,
          amount: split.absent > 0 ? `−${formatAmount(split.absent)}` : "0",
        }
      : { kind: "line", label: "Absence", qty: plural(a.absent, "day"), rate: "not paid", amount: "0" },
  );
  // Past working days without a record: unpaid like absent (its own red line when there are any).
  if (notMarked > 0) {
    rows.push(
      l.pay_type === "monthly"
        ? {
            kind: "line",
            label: "Not marked",
            qty: plural(notMarked, "day"),
            rate: `${formatAmount(absencePerDay(l))} / day`,
            amount: split.not_marked > 0 ? `−${formatAmount(split.not_marked)}` : "0",
            danger: true,
          }
        : { kind: "line", label: "Not marked", qty: plural(notMarked, "day"), rate: "not paid", amount: "0", danger: true },
    );
  }
  rows.push({ kind: "net", label: "Net salary", qty: "", rate: "", amount: formatAmount(l.net) });
  rows.push({
    kind: "paid",
    label: "Paid (salary + advances)",
    qty: "",
    rate: "",
    amount: l.paid > 0 ? `−${formatAmount(l.paid)}` : "0",
  });
  rows.push({ kind: "due", label: "Due", qty: "", rate: "", amount: formatAmount(l.due), owing: l.due > 0 });
  return rows;
}

/** Mark attendance with the "Not marked" filter on. */
export const UNMARKED_HREF = "/attendance/mark?status=N";

/** Salary report warning: "3 employees have unmarked days this month"; null when nobody has any. */
export function unmarkedWarningText(totals: Pick<ReportTotals, "not_marked_staff">): string | null {
  const n = totals.not_marked_staff ?? 0;
  if (n <= 0) return null;
  return `${n} employee${n === 1 ? " has" : "s have"} unmarked days this month.`;
}
