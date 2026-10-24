/**
 * Client-side export stand-ins. The backend will serve real .xlsx and PDF
 * files through core.export; until then Excel buttons download a CSV built
 * from the same rows and PDF / receipt buttons open a printable page.
 */

import { formatBsLong, formatMonthRange, monthLabel } from "./calendar";
import { STATUS_LABEL, formatDays, formatRs, toCsv } from "./helpers";
import type { Employee, MonthLedger, Payment, RegisterRow, ReportRow } from "../types";

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

/** Opens `html` in a new tab and triggers print (PDF stand-in). False when blocked. */
export function printHtml(html: string): boolean {
  const win = window.open("", "_blank", "noopener,noreferrer,width=760,height=900");
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}

function payTypeLabel(ledger: MonthLedger): string {
  return ledger.pay_type === "monthly" ? "Monthly" : "Daily wage";
}

export function modeLabel(payment: Payment): string {
  return payment.mode === "bank" ? `Bank${payment.reference ? ` · ${payment.reference}` : ""}` : "Cash";
}

/** Salary report sheet (everyone in the current filter) as CSV. */
export function payrollSheetCsv(rows: ReportRow[]): string {
  return toCsv(
    ["Code", "Employee", "Designation", "Department", "Branch", "Pay type", "Paid days", "Days in month", "Gross", "Overtime", "Absence", "Advance paid", "TDS", "Net", "Paid", "Due", "Status"],
    rows.map(({ employee, ledger }) => [
      employee.code,
      employee.full_name,
      employee.designation ?? "",
      employee.department?.name ?? "",
      employee.branch.name,
      payTypeLabel(ledger),
      formatDays(ledger.paid_days),
      ledger.attendance.days_in_month,
      ledger.earnings,
      ledger.overtime_pay,
      ledger.absence_deduction,
      ledger.advance_paid,
      ledger.tds,
      ledger.net,
      ledger.paid,
      ledger.due,
      STATUS_LABEL[ledger.status],
    ]),
  );
}

/** One employee's salary ledger as CSV. */
export function ledgerCsv(employee: Employee, ledgers: MonthLedger[]): string {
  return toCsv(
    ["Month (BS)", "Pay type", "Rate", "Paid days", "Days in month", "Gross", "Overtime hours", "Overtime", "Absence", "TDS", "Net", "Paid", "Due", "Status"],
    ledgers.map((l) => [
      monthLabel(l.month),
      payTypeLabel(l),
      l.rate,
      formatDays(l.paid_days),
      l.attendance.days_in_month,
      l.gross_salary,
      l.attendance.overtime_hours,
      l.overtime_pay,
      l.absence_deduction,
      l.tds,
      l.net,
      l.paid,
      l.due,
      STATUS_LABEL[l.status],
    ]),
  );
}

/** Payments register as CSV. */
export function registerCsv(rows: RegisterRow[]): string {
  return toCsv(
    ["Date (BS)", "Date (AD)", "Code", "Employee", "Department", "For month", "Type", "Paid by", "Reference", "Amount", "Recorded by", "Source", "Note"],
    rows.map(({ payment, employee }) => [
      payment.date.bs,
      payment.date.ad,
      employee.code,
      employee.full_name,
      employee.department?.name ?? "",
      monthLabel(payment.month),
      payment.type === "salary" ? "Salary" : "Advance",
      payment.mode === "bank" ? "Bank" : "Cash",
      payment.reference ?? "",
      payment.amount,
      payment.recorded_by,
      payment.source,
      payment.note ?? "",
    ]),
  );
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

const PRINT_CSS = `
body{font-family:"IBM Plex Sans",system-ui,sans-serif;color:#1b2328;margin:32px;max-width:640px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;color:#5b6670;margin:0 0 20px;font-weight:500}
h3{font-size:13px;color:#5b6670;margin:18px 0 6px;text-transform:uppercase;letter-spacing:.04em}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:7px 0;border-bottom:1px solid #eef0ec;text-align:left}
td.num,th.num{text-align:right;font-family:"IBM Plex Mono",ui-monospace,monospace}tr.strong td{font-weight:700;border-top:2px solid #cbd2cc;border-bottom:none}
.meta{display:flex;justify-content:space-between;gap:16px;margin-bottom:12px;font-size:13px;color:#5b6670}
.note{margin-top:20px;font-size:12px;color:#5b6670}
.big{font-size:28px;font-weight:700;font-family:"IBM Plex Mono",ui-monospace,monospace;margin:12px 0}
@media print{body{margin:0}}`;

/** Printable payslip (stand-in for the WeasyPrint PDF). */
export function payslipHtml(employee: Employee, l: MonthLedger): string {
  const line = (label: string, value: string, strong = false) =>
    `<tr${strong ? ' class="strong"' : ""}><td>${escapeHtml(label)}</td><td class="num">${escapeHtml(value)}</td></tr>`;
  const perDay = l.attendance.days_in_month ? l.rate / l.attendance.days_in_month : 0;
  const rate =
    l.pay_type === "monthly"
      ? `Monthly salary ${formatRs(l.rate)} · overtime ${formatRs(l.ot_rate)}/h`
      : `Daily wage ${formatRs(l.rate)} × ${formatDays(l.paid_days)} days · overtime ${formatRs(l.ot_rate)}/h`;
  const payments = l.payments
    .map((p) => `<tr><td>${escapeHtml(formatBsLong(p.date.bs))}</td><td>${p.type === "salary" ? "Salary" : "Advance"}</td><td>${escapeHtml(modeLabel(p))}</td><td class="num">${escapeHtml(formatRs(p.amount))}</td></tr>`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Payslip ${escapeHtml(employee.code)} ${escapeHtml(monthLabel(l.month))}</title>
<style>${PRINT_CSS}</style></head><body>
<h1>Payslip · ${escapeHtml(monthLabel(l.month))}${l.in_progress ? " (in progress)" : ""}</h1>
<h2>${escapeHtml(employee.full_name)} · ${escapeHtml(employee.code)} · ${escapeHtml(employee.designation ?? "")} · ${escapeHtml(employee.department?.name ?? "")} · ${escapeHtml(employee.branch.name)}</h2>
<div class="meta"><span>${escapeHtml(formatMonthRange(l.month))}</span><span>${escapeHtml(rate)}</span></div>
<h3>Attendance</h3>
<table>
${line("Days in month", String(l.attendance.days_in_month))}
${line("Present", String(l.attendance.present))}
${line("Overtime days · hours", `${l.attendance.overtime_days} · ${l.attendance.overtime_hours} h`)}
${line("Absent", String(l.attendance.absent))}
${line("Weekly off (paid)", String(l.attendance.weekly_off))}
</table>
<h3>Earnings</h3>
<table>
${line(l.pay_type === "monthly" ? "Salary" : `Wage × ${formatDays(l.paid_days)} days`, formatRs(l.gross_salary))}
${line(`Overtime ${l.attendance.overtime_hours} h × ${formatRs(l.ot_rate)}`, formatRs(l.overtime_pay))}
${line("Total earnings", formatRs(l.earnings), true)}
</table>
<h3>Deductions</h3>
<table>
${line(l.pay_type === "monthly" ? `Absence ${l.attendance.absent} × ${formatRs(perDay)} per day` : "Absence", l.absence_deduction ? `− ${formatRs(l.absence_deduction)}` : "Rs 0")}
${line("TDS", l.tds ? `− ${formatRs(l.tds)}` : "Rs 0")}
${line("Net salary", formatRs(l.net), true)}
</table>
<h3>Payments</h3>
<table><tr><th>Date</th><th>Type</th><th>Paid by</th><th class="num">Amount</th></tr>${payments || '<tr><td colspan="4">No payment yet.</td></tr>'}
<tr class="strong"><td colspan="3">Paid ${formatRs(l.paid)} · due ${formatRs(l.due)}</td><td class="num">${escapeHtml(STATUS_LABEL[l.status])}</td></tr></table>
<p class="note">${
    l.pay_type === "monthly"
      ? "Net = salary − salary ÷ days in month × absent days + overtime − TDS. Saturdays are paid. Advances are part of this month's salary."
      : "Net = wage × (present + overtime days) + overtime hours × rate − TDS. Advances are part of this month's salary."
  }</p>
<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},150)})</script>
</body></html>`;
}

/** Printable receipt for one payment. */
export function receiptHtml(employee: Employee, payment: Payment, due_after: number | null): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Receipt ${payment.id} · ${escapeHtml(employee.code)}</title>
<style>${PRINT_CSS}</style></head><body>
<h1>${payment.type === "salary" ? "Salary payment" : "Advance payment"} · receipt #${payment.id}</h1>
<h2>${escapeHtml(employee.full_name)} · ${escapeHtml(employee.code)} · ${escapeHtml(employee.department?.name ?? "")}</h2>
<div class="big">${escapeHtml(formatRs(payment.amount))}</div>
<table>
<tr><td>For month</td><td class="num">${escapeHtml(monthLabel(payment.month))}</td></tr>
<tr><td>Date</td><td class="num">${escapeHtml(formatBsLong(payment.date.bs))} · ${escapeHtml(payment.date.ad)}</td></tr>
<tr><td>Paid by</td><td class="num">${escapeHtml(modeLabel(payment))}</td></tr>
<tr><td>Recorded by</td><td class="num">${escapeHtml(payment.recorded_by)}${payment.source === "scan" ? " (attendance scan)" : ""}</td></tr>
${payment.note ? `<tr><td>Note</td><td class="num">${escapeHtml(payment.note)}</td></tr>` : ""}
${due_after !== null ? `<tr class="strong"><td>Balance due for ${escapeHtml(monthLabel(payment.month))} after this payment</td><td class="num">${escapeHtml(formatRs(due_after))}</td></tr>` : ""}
</table>
<p class="note">${payment.type === "advance" ? "An advance counts as part of this month's salary; it is not recovered later." : "Signature: ______________________"}</p>
<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},150)})</script>
</body></html>`;
}

export function printPayslip(employee: Employee, ledger: MonthLedger): boolean {
  return printHtml(payslipHtml(employee, ledger));
}

export function printReceipt(employee: Employee, payment: Payment, due_after: number | null): boolean {
  return printHtml(receiptHtml(employee, payment, due_after));
}
