/**
 * Client-side export stand-ins. The backend will serve real .xlsx and PDF
 * files through core.export; until then Excel buttons download a CSV built
 * from the same rows and PDF buttons open a printable page.
 */

import { formatBsLong, monthLabel } from "./calendar";
import { formatDays, formatRs, toCsv } from "./helpers";
import type { EmployeeProfile, PayrollSheetRow, Payslip } from "./types";

export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function payTypeLabel(payslip: Payslip): string {
  return payslip.pay_type === "monthly" ? "Monthly" : "Daily wage";
}

function statusLabel(payslip: Payslip): string {
  return payslip.status === "paid" && payslip.paid_on ? `Paid ${payslip.paid_on.bs}` : "Pending";
}

/** Payroll sheet (everyone in the current filter) as CSV. */
export function payrollSheetCsv(rows: PayrollSheetRow[]): string {
  return toCsv(
    ["Code", "Employee", "Designation", "Department", "Branch", "Pay type", "Paid days", "Days in month", "Gross", "Absence deduction", "Advance recovered", "Net pay", "Paid by", "Status"],
    rows.map(({ employee, payslip }) => [
      employee.code,
      employee.full_name,
      employee.designation ?? "",
      employee.department?.name ?? "",
      employee.branch.name,
      payTypeLabel(payslip),
      formatDays(payslip.paid_days),
      payslip.days_in_month,
      payslip.gross,
      payslip.absence_deduction,
      payslip.advance_recovered,
      payslip.net_pay,
      payslip.paid_by === "bank" ? "Bank" : "Cash",
      statusLabel(payslip),
    ]),
  );
}

/** Bank transfer sheet: bank-paid staff only, one line per transfer. */
export function bankSheetCsv(rows: PayrollSheetRow[]): string {
  const bank = rows.filter((row) => row.payslip.paid_by === "bank");
  return toCsv(
    ["Code", "Employee", "Department", "Month (BS)", "Net pay", "Status"],
    bank.map(({ employee, payslip }) => [
      employee.code,
      employee.full_name,
      employee.department?.name ?? "",
      monthLabel(payslip.month),
      payslip.net_pay,
      statusLabel(payslip),
    ]),
  );
}

/** One employee's salary ledger as CSV. */
export function ledgerCsv(employee: EmployeeProfile, payslips: Payslip[]): string {
  return toCsv(
    ["Month (BS)", "Pay type", "Rate", "Paid days", "Days in month", "Gross", "Absence deduction", "Advance", "Net pay", "Status"],
    payslips.map((p) => [
      monthLabel(p.month),
      payTypeLabel(p),
      p.rate,
      formatDays(p.paid_days),
      p.days_in_month,
      p.gross,
      p.absence_deduction,
      p.advance_recovered,
      p.net_pay,
      statusLabel(p),
    ]),
  );
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

/** Printable payslip (stand-in for the WeasyPrint PDF). */
export function payslipHtml(employee: EmployeeProfile, payslip: Payslip): string {
  const line = (label: string, value: string, strong = false) =>
    `<tr${strong ? ' class="strong"' : ""}><td>${escapeHtml(label)}</td><td class="num">${escapeHtml(value)}</td></tr>`;
  const rate =
    payslip.pay_type === "monthly"
      ? `Monthly salary ${formatRs(payslip.rate)}`
      : `Daily wage ${formatRs(payslip.rate)} per day × ${formatDays(payslip.paid_days)} days`;
  const paid = payslip.paid_on
    ? `Paid ${formatBsLong(payslip.paid_on.bs)} (${payslip.paid_on.ad})`
    : "Pending";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Payslip ${escapeHtml(employee.code)} ${escapeHtml(monthLabel(payslip.month))}</title>
<style>
body{font-family:"IBM Plex Sans",system-ui,sans-serif;color:#1b2328;margin:32px;max-width:640px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;color:#5b6670;margin:0 0 20px;font-weight:500}
table{width:100%;border-collapse:collapse;font-size:14px}td{padding:8px 0;border-bottom:1px solid #eef0ec}
td.num{text-align:right;font-family:"IBM Plex Mono",ui-monospace,monospace}tr.strong td{font-weight:700;border-top:2px solid #cbd2cc;border-bottom:none}
.meta{display:flex;justify-content:space-between;gap:16px;margin-bottom:20px;font-size:13px;color:#5b6670}
.note{margin-top:20px;font-size:12px;color:#5b6670}
@media print{body{margin:0}}
</style></head><body>
<h1>Payslip · ${escapeHtml(monthLabel(payslip.month))}</h1>
<h2>${escapeHtml(employee.full_name)} · ${escapeHtml(employee.code)} · ${escapeHtml(employee.designation ?? "")} · ${escapeHtml(employee.department?.name ?? "")} · ${escapeHtml(employee.branch.name)}</h2>
<div class="meta"><span>${escapeHtml(rate)}</span><span>${escapeHtml(paid)} · ${payslip.paid_by === "bank" ? "Bank" : "Cash"}</span></div>
<table>
${line("Paid days", `${formatDays(payslip.paid_days)} / ${payslip.days_in_month}`)}
${line("Gross", formatRs(payslip.gross))}
${line("Absence deduction", payslip.absence_deduction ? `− ${formatRs(payslip.absence_deduction)}` : "Rs 0")}
${line("Advance recovered", payslip.advance_recovered ? `− ${formatRs(payslip.advance_recovered)}` : "Rs 0")}
${line("Net pay", formatRs(payslip.net_pay), true)}
</table>
<p class="note">${
    payslip.pay_type === "monthly"
      ? "Absence deduction = salary ÷ days in month × unpaid days (absent = 1, half day = ½). Leave and Saturdays are paid."
      : "Pay = wage × days present (half day = ½). Leave and absent days are unpaid."
  }</p>
<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},150)})</script>
</body></html>`;
}

/** Opens the payslip in a new tab and triggers print (PDF stand-in). */
export function printPayslip(employee: EmployeeProfile, payslip: Payslip): boolean {
  const win = window.open("", "_blank", "noopener,noreferrer,width=760,height=900");
  if (!win) return false;
  win.document.open();
  win.document.write(payslipHtml(employee, payslip));
  win.document.close();
  return true;
}
