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

/** The days the deduction covers: absent + not marked + after leaving + unpaid public holidays. */
function unpaidDays(l: Pick<MonthLedger, "attendance">): number {
  const a = l.attendance;
  return a.absent + (a.not_marked ?? 0) + (a.days_after_leaving ?? 0) + (a.unpaid_holidays ?? 0);
}

/** Per unpaid day: what was actually deducted ÷ those days (salary ÷ 30 when none). */
export function absencePerDay(l: Pick<MonthLedger, "rate" | "absence_deduction" | "attendance">): number {
  const unpaid = unpaidDays(l);
  return unpaid > 0 ? Math.round(l.absence_deduction / unpaid) : Math.round(l.rate / 30);
}

/** The deduction split between absent, not marked and after-leaving days (they add up to absence_deduction). */
export function deductionSplit(l: Pick<MonthLedger, "absence_deduction" | "attendance">): { absent: number; not_marked: number; after_leaving: number } {
  const notMarked = l.attendance.not_marked ?? 0;
  const after = l.attendance.days_after_leaving ?? 0;
  const unpaid = unpaidDays(l);
  const absentPart = unpaid > 0 ? Math.round((l.absence_deduction * l.attendance.absent) / unpaid) : l.absence_deduction;
  if (unpaid <= 0 || notMarked + after <= 0) return { absent: absentPart, not_marked: 0, after_leaving: 0 };
  const nm = Math.round((l.absence_deduction * notMarked) / unpaid);
  const al = Math.round((l.absence_deduction * after) / unpaid);
  // Whatever is left after the others is the absent days' share (and any unpaid holidays').
  const holidays = l.attendance.unpaid_holidays ?? 0;
  return { absent: holidays > 0 ? absentPart : l.absence_deduction - nm - al, not_marked: nm, after_leaving: al };
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
  // An employee who left: the days after the leaving day are unpaid too.
  const afterLeaving = a.days_after_leaving ?? 0;
  if (afterLeaving > 0 && l.pay_type === "monthly") {
    rows.push({
      kind: "line",
      label: "After leaving",
      qty: plural(afterLeaving, "day"),
      rate: `${formatAmount(absencePerDay(l))} / day`,
      amount: split.after_leaving > 0 ? `−${formatAmount(split.after_leaving)}` : "0",
      danger: true,
    });
  }
  // An unpaid public holiday without a mark: the day is cut (never shown as absent).
  const unpaidHolidays = a.unpaid_holidays ?? 0;
  if (unpaidHolidays > 0 && l.pay_type === "monthly") {
    const amount = l.absence_deduction - split.absent - split.not_marked - split.after_leaving;
    rows.push({
      kind: "line",
      label: "Unpaid holiday",
      qty: plural(unpaidHolidays, "day"),
      rate: `${formatAmount(absencePerDay(l))} / day`,
      amount: amount > 0 ? `−${formatAmount(amount)}` : "0",
    });
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
