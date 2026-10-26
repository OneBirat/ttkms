/**
 * Salary tab · expanded month (ledger-touch item 2): one table instead of the Attendance /
 * Earnings / Deductions boxes - Description · Days / hours · Rate (Rs) · Amount (Rs), an Earnings
 * and a Deductions section, then Net salary, Paid (salary + advances) and Due. No attendance
 * section, no TDS.
 */

import { formatAmount } from "./helpers";
import type { MonthLedger } from "../types";

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
    };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Per absent day: what was actually deducted ÷ absent days (salary ÷ 30 when none). */
export function absencePerDay(l: Pick<MonthLedger, "rate" | "absence_deduction" | "attendance">): number {
  const absent = l.attendance.absent;
  return absent > 0 ? Math.round(l.absence_deduction / absent) : Math.round(l.rate / 30);
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
  rows.push(
    l.pay_type === "monthly"
      ? {
          kind: "line",
          label: "Absence",
          qty: plural(a.absent, "day"),
          rate: `${formatAmount(absencePerDay(l))} / day`,
          amount: l.absence_deduction > 0 ? `−${formatAmount(l.absence_deduction)}` : "0",
        }
      : { kind: "line", label: "Absence", qty: plural(a.absent, "day"), rate: "not paid", amount: "0" },
  );
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
