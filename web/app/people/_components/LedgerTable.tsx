"use client";

import { Fragment, useState } from "react";
import { Pill } from "@/components/ui/Pill";
import { PayrollIcon } from "./icons";
import { BSDateText } from "@/components/date";
import { formatBsShort } from "@/lib/bs";
import { formatMonthRange, monthLabel } from "../_lib/months";
import { payslipUrl, receiptUrl } from "../api";
import { downloadText, ledgerCsv, modeLabel } from "../_lib/exports";
import {
  STATUS_LABEL,
  formatAddition,
  formatAmount,
  formatDays,
  formatDeduction,
  formatPaidDays,
  formatRs,
  statusPill,
} from "../_lib/helpers";
import type { BsMonth, Employee, MonthLedger, Payment } from "../types";
import { VoidPaymentDialog, VoidedNote, useCanVoid } from "./VoidPaymentDialog";
import styles from "./employees.module.css";
import shared from "./payroll.module.css";

export interface LedgerTableProps {
  employee: Employee;
  ledger: MonthLedger[];
  onRecordPayment: (month: BsMonth) => void;
}

function StatusPill({ ledger }: { ledger: MonthLedger }) {
  if (ledger.status === "pending") return <span className={shared.pillNeutral}>Pending</span>;
  const counted = ledger.payments.filter((p) => !p.voided);
  const last = counted[counted.length - 1];
  const label = ledger.status === "paid" && last ? `Paid ${formatBsShort(last.date.bs)}` : STATUS_LABEL[ledger.status];
  return <Pill status={statusPill(ledger.status)} label={label} />;
}

/** Month rows; clicking one expands a detail row inside the table (no side panel). */
export function LedgerTable({ employee, ledger, onRecordPayment }: LedgerTableProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const canVoid = useCanVoid();
  const key = (l: MonthLedger) => `${l.month.bs_year}-${l.month.bs_month}`;
  const blocked = () => window.alert("The browser blocked the print window. Allow pop-ups for this site and try again.");
  // The header's "Payslip PDF" prints the latest completed month.
  const latest = ledger.find((l) => !l.in_progress) ?? ledger[0] ?? null;

  return (
    <section aria-labelledby="ledger-h" className={`card ${styles.ledger}`}>
      <div className={styles.ledgerHead}>
        <h3 id="ledger-h" className={shared.cardTitle}>
          Salary ledger
        </h3>
        <div className={shared.row} style={{ gap: 8 }}>
          <button
            type="button"
            className="btn btn--sm"
            disabled={!latest}
            title={latest ? `Payslip for ${monthLabel(latest.month)}` : undefined}
            onClick={() => {
              if (latest && !window.open(payslipUrl(employee.id, latest.month), "_blank", "noopener")) blocked();
            }}
          >
            Payslip PDF
          </button>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => downloadText(`${employee.code}-salary-ledger.csv`, ledgerCsv(employee, ledger))}
            disabled={ledger.length === 0}
          >
            Excel
          </button>
        </div>
      </div>
      <div className={shared.tableWrap}>
        <table className={`${shared.table} ${shared.tableCentred}`}>
          <caption className={shared.srOnly}>Salary ledger for {employee.full_name}; select a month for details</caption>
          <thead>
            <tr>
              <th scope="col">Month (BS)</th>
              <th scope="col" className={shared.num}>
                Paid days
              </th>
              <th scope="col" className={shared.num}>
                Gross
              </th>
              <th scope="col" className={shared.num}>
                Overtime
              </th>
              <th scope="col" className={shared.num}>
                Absence
              </th>
              <th scope="col" className={shared.num}>
                TDS
              </th>
              <th scope="col" className={shared.num}>
                Net pay
              </th>
              <th scope="col">Status</th>
              <th scope="col" className={styles.expandCell}>
                <span className={shared.srOnly}>Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ledger.length === 0 ? (
              <tr>
                <td colSpan={9} className={shared.empty}>
                  No salary months yet.
                </td>
              </tr>
            ) : (
              ledger.map((l) => {
                const expanded = open === key(l);
                const detailId = `ledger-detail-${employee.id}-${key(l)}`;
                return (
                  <Fragment key={key(l)}>
                    <tr
                      className={styles.ledgerRow}
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : key(l))}
                    >
                      <td>
                        {monthLabel(l.month)}
                        {l.in_progress ? <span className={shared.note}> · in progress</span> : null}
                      </td>
                      <td className={shared.num}>{formatPaidDays(l.paid_days, l.attendance.days_in_month)}</td>
                      <td className={shared.num}>{formatAmount(l.gross_salary)}</td>
                      <td className={shared.num}>{formatAddition(l.overtime_pay)}</td>
                      <td className={shared.num}>{formatDeduction(l.absence_deduction)}</td>
                      <td className={shared.num}>{formatDeduction(l.tds)}</td>
                      <td className={`${shared.num} ${shared.kvStrong}`}>{formatAmount(l.net)}</td>
                      <td>
                        <StatusPill ledger={l} />
                      </td>
                      <td className={styles.expandCell}>
                        <button
                          type="button"
                          className={styles.expandButton}
                          aria-expanded={expanded}
                          aria-controls={detailId}
                          aria-label={`${expanded ? "Hide" : "Show"} details for ${monthLabel(l.month)}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpen(expanded ? null : key(l));
                          }}
                        >
                          <PayrollIcon name={expanded ? "chevron-up" : "chevron-down"} size={18} />
                        </button>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr id={detailId}>
                        <td colSpan={9} className={styles.detailCell}>
                          <LedgerDetail
                            employee={employee}
                            ledger={l}
                            onClose={() => setOpen(null)}
                            onRecordPayment={() => onRecordPayment(l.month)}
                            onPayslip={() => {
                              if (!window.open(payslipUrl(employee.id, l.month), "_blank", "noopener")) blocked();
                            }}
                            onReceipt={(payment) => {
                              if (!window.open(receiptUrl(payment.id), "_blank", "noopener")) blocked();
                            }}
                            onVoid={canVoid ? setVoiding : undefined}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <span className={styles.ledgerNote}>
        Monthly: net = salary − salary ÷ days in month × absent days + overtime − TDS; Saturdays are paid. Daily wage:
        net = wage × days present (overtime days included) + overtime hours × rate − TDS. Advances are part of that
        month&apos;s salary. The running month shows the monthly salary in full less absences so far (daily wages count days so far). Attendance comes from the attendance module.
      </span>
      <VoidPaymentDialog payment={voiding} employeeName={employee.full_name} onClose={() => setVoiding(null)} />
    </section>
  );
}

interface LedgerDetailProps {
  employee: Employee;
  ledger: MonthLedger;
  onClose: () => void;
  onRecordPayment: () => void;
  onPayslip: () => void;
  onReceipt: (payment: Payment) => void;
  /** Admins: "Void payment" on each payment row. */
  onVoid?: (payment: Payment) => void;
}

function LedgerDetail({ ledger: l, onClose, onRecordPayment, onPayslip, onReceipt, onVoid }: LedgerDetailProps) {
  const countedPayments = l.payments.filter((p) => !p.voided).length;
  const perDay = l.attendance.days_in_month ? l.rate / l.attendance.days_in_month : 0;
  const a = l.attendance;
  return (
    <div className={styles.detail}>
      <div className={styles.detailTop}>
        <div className={styles.detailTitle}>
          <span className={styles.detailMonth}>
            {monthLabel(l.month)}
            {l.in_progress ? " · in progress" : ""}
          </span>
          <span className={styles.detailRange}>{formatMonthRange(l.month)}</span>
        </div>
        <div className={styles.detailFigures}>
          <span>
            Net <strong>{formatRs(l.net)}</strong>
          </span>
          <span>
            Paid <strong className={shared.ok}>{formatRs(l.paid)}</strong>
          </span>
          <span>
            Due <strong className={l.due > 0 ? shared.danger : undefined}>{formatRs(l.due)}</strong>
          </span>
        </div>
        <div className={styles.detailActions}>
          <button type="button" className="btn btn--sm" onClick={onPayslip}>
            Payslip PDF
          </button>
          {l.due > 0 ? (
            <button type="button" className="btn btn--sm btn--primary" onClick={onRecordPayment}>
              Record payment
            </button>
          ) : null}
          <button type="button" className="btn btn--sm btn--ghost" onClick={onClose}>
            Close
            <PayrollIcon name="chevron-up" size={16} />
          </button>
        </div>
      </div>

      <div className={styles.miniTables}>
        <div className={styles.mini}>
          <span className={styles.miniTitle}>Attendance</span>
          <div className={styles.kv}>
            <span>Days in month</span>
            <span className={shared.num}>{a.days_in_month}</span>
          </div>
          <div className={styles.kv}>
            <span>Present</span>
            <span className={shared.num}>{formatDays(a.present)}</span>
          </div>
          <div className={styles.kv}>
            <span>Absent</span>
            <span className={shared.num}>{a.absent}</span>
          </div>
          <div className={styles.kv}>
            <span>Overtime</span>
            <span className={shared.num}>
              {a.overtime_days} d · {a.overtime_hours} h
            </span>
          </div>
          <div className={styles.kv}>
            <span>Weekly off (Sat)</span>
            <span className={shared.num}>{a.weekly_off}</span>
          </div>
        </div>
        <div className={styles.mini}>
          <span className={styles.miniTitle}>Earnings</span>
          <div className={styles.kv}>
            <span>{l.pay_type === "monthly" ? "Salary" : `Wage ${formatRs(l.rate)} × ${formatDays(l.paid_days)} days`}</span>
            <span className={shared.num}>{formatAmount(l.gross_salary)}</span>
          </div>
          <div className={styles.kv}>
            <span>
              Overtime {a.overtime_hours} h × {formatRs(l.ot_rate)}
            </span>
            <span className={shared.num}>{formatAmount(l.overtime_pay)}</span>
          </div>
          <div className={`${styles.kv} ${styles.kvTotal}`}>
            <span>Total earnings</span>
            <span className={shared.num}>{formatAmount(l.earnings)}</span>
          </div>
        </div>
        <div className={styles.mini}>
          <span className={styles.miniTitle}>Deductions</span>
          <div className={styles.kv}>
            <span>{l.pay_type === "monthly" ? `Absence ${a.absent} × ${formatRs(perDay)}/day` : "Absence (daily wage: none)"}</span>
            <span className={shared.num}>{formatDeduction(l.absence_deduction)}</span>
          </div>
          <div className={styles.kv}>
            <span>TDS</span>
            <span className={shared.num}>{formatDeduction(l.tds)}</span>
          </div>
          <div className={`${styles.kv} ${styles.kvTotal}`}>
            <span>Net salary</span>
            <span className={shared.num}>{formatAmount(l.net)}</span>
          </div>
        </div>
      </div>

      <div className={styles.payments}>
        <div className={styles.paymentsHead}>
          <span className={styles.miniTitle} style={{ paddingBottom: 0 }}>
            Payments
          </span>
          <span className={styles.paymentsTotal}>
            Total paid {formatRs(l.paid)} · {countedPayments} payment{countedPayments === 1 ? "" : "s"}
          </span>
        </div>
        <div className={shared.tableWrap}>
          <table className={shared.table}>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Type</th>
                <th scope="col">Details</th>
                <th scope="col">Paid by</th>
                <th scope="col" className={shared.num}>
                  Amount
                </th>
                <th scope="col">
                  <span className={shared.srOnly}>Receipt</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {l.payments.length === 0 ? (
                <tr>
                  <td colSpan={6} className={shared.empty}>
                    No payment yet{l.due > 0 ? ` · ${formatRs(l.due)} due` : ""}.
                  </td>
                </tr>
              ) : (
                l.payments.map((p) => (
                  <tr key={p.id} className={p.voided ? shared.voidedRow : undefined}>
                    <td>
                      <BSDateText value={p.date.bs} inline />
                    </td>
                    <td>
                      <span className={p.kind === "advance" ? shared.pillAdvance : shared.pillSalary}>
                        {p.kind === "advance" ? "Advance" : "Salary"}
                      </span>
                    </td>
                    <td style={{ whiteSpace: "normal" }}>
                      {p.note ?? (p.kind === "advance" ? "Part of this month's salary" : "—")}
                      {p.source === "scan" ? <span className={shared.note}> · from attendance scan</span> : null}
                      <VoidedNote payment={p} />
                    </td>
                    <td>
                      {modeLabel(p)}
                      <span className={shared.note}> · {p.recorded_by}</span>
                    </td>
                    <td className={`${shared.num} ${shared.kvStrong} ${p.voided ? shared.voidedAmount : ""}`}>{formatAmount(p.amount)}</td>
                    <td>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => onReceipt(p)}>
                        Receipt
                      </button>
                      {onVoid && !p.voided ? (
                        <button type="button" className="btn btn--ghost btn--sm" onClick={() => onVoid(p)}>
                          Void
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
