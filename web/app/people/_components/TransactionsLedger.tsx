"use client";

import { Fragment, useState } from "react";
import { getEmployeeLedger } from "../api";
import { downloadText } from "../_lib/exports";
import { formatAmount, formatRs, toCsv } from "../_lib/helpers";
import { BSDateText } from "@/components/date";
import type { Employee, LedgerEntry, LedgerEntryType } from "../types";
import { payrollErrorMessage, usePayroll } from "../_lib/usePayroll";
import { useSession } from "@/lib/session";
import { PaymentRemarks, bulkMonths } from "./PaymentRemarks";
import styles from "./employees.module.css";
import shared from "./payroll.module.css";

type Filter = "all" | LedgerEntryType;

export const ENTRY_LABEL: Record<LedgerEntryType, string> = {
  salary: "Salary",
  absence: "Absence",
  overtime: "Overtime",
  advance: "Advance",
  salary_paid: "Salary paid",
};

const CHIPS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "salary", label: "Salary" },
  { value: "overtime", label: "Overtime" },
  { value: "advance", label: "Advance" },
  { value: "salary_paid", label: "Salary payments" },
];

/** Does a line show under a chip? "Salary" includes its absence deductions. */
export function entryMatches(entry: LedgerEntry, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "salary") return entry.type === "salary" || entry.type === "absence";
  return entry.type === filter;
}

/**
 * Ledger tab (design Employees.dc.html / ledger-touch): tiles, chips, every transaction with a
 * running balance. A bulk salary payment is one row on its payment date; every payment row
 * carries the read-only System remark and the editable human note (PaymentRemarks).
 */
export function TransactionsLedger({ employee }: { employee: Employee }) {
  const ledger = usePayroll(() => getEmployeeLedger(employee.id), [employee.id]);
  const { can } = useSession();
  const canNote = can("salary_advances");
  const [filter, setFilter] = useState<Filter>("all");
  const data = ledger.data;
  if (ledger.error) return <p className={shared.formError}>{payrollErrorMessage(ledger.error)}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const shown = [...data.entries].reverse().filter((e) => entryMatches(e, filter));
  const t = data.totals;
  const earned = shown.reduce((s, e) => s + e.earned, 0);
  const paid = shown.reduce((s, e) => s + e.paid, 0);

  const exportCsv = () =>
    downloadText(
      `${employee.code}-ledger.csv`,
      toCsv(
        ["Date (BS)", "Date (AD)", "Type", "Details", "System remark", "Note", "Earned", "Paid", "Balance due"],
        shown.map((e) => [
          e.date.bs,
          e.date.ad,
          bulkMonths(e) ? `${ENTRY_LABEL[e.type]} (bulk · ${bulkMonths(e)} months)` : ENTRY_LABEL[e.type],
          e.details,
          e.payment?.system_remark ?? "",
          e.payment?.note ?? "",
          e.earned,
          e.paid,
          e.balance,
        ]),
      ),
    );

  return (
    <section aria-labelledby="tx-h" className={shared.stack} style={{ gap: 14 }}>
      <div className={styles.tiles5}>
        <div className={shared.tile} data-tone="ok">
          <span className={shared.tileLabel}>Total salary</span>
          <span className={shared.tileValue} style={{ fontSize: 20 }}>
            {formatRs(t.salary)}
          </span>
          <span className={shared.tileLabel} style={{ opacity: 0.75 }}>
            after absence deductions
          </span>
        </div>
        <div className={shared.tile} data-tone="ot">
          <span className={shared.tileLabel}>Overtime</span>
          <span className={shared.tileValue} style={{ fontSize: 20 }}>
            {formatRs(t.overtime)}
          </span>
          <span className={shared.tileLabel} style={{ opacity: 0.75 }}>
            {t.overtime_hours} h in {t.months} months
          </span>
        </div>
        <div className={shared.tile} data-tone="advance">
          <span className={shared.tileLabel}>Advance payments</span>
          <span className={shared.tileValue} style={{ fontSize: 20 }}>
            {formatRs(t.advances)}
          </span>
          <span className={shared.tileLabel} style={{ opacity: 0.75 }}>
            {t.advance_count} advances
          </span>
        </div>
        <div className={shared.tile} data-tone="neutral">
          <span className={shared.tileLabel}>Salary payments</span>
          <span className={shared.tileValue} style={{ fontSize: 20 }}>
            {formatRs(t.salary_payments)}
          </span>
          <span className={shared.tileLabel} style={{ opacity: 0.75 }}>
            {t.salary_payment_count} payments
          </span>
        </div>
        <div className={shared.tile} data-tone={t.balance > 0 ? "danger" : "plain"}>
          <span className={shared.tileLabel}>Balance due</span>
          <span className={shared.tileValue} style={{ fontSize: 20 }}>
            {formatRs(t.balance)}
          </span>
          <span className={shared.tileLabel} style={{ opacity: 0.75 }}>
            {t.balance > 0 ? "still to pay" : "fully paid"}
          </span>
        </div>
      </div>

      <div className={`card ${styles.ledger}`}>
        <div className={styles.ledgerHead}>
          <h3 id="tx-h" className={shared.cardTitle}>
            Employee ledger · all transactions
          </h3>
          <div className={shared.row} style={{ gap: 8 }}>
            <div role="group" aria-label="Type" className={styles.deptChips}>
              {CHIPS.map((c) => (
                <button key={c.value} type="button" className={styles.deptChip} aria-pressed={filter === c.value} onClick={() => setFilter(c.value)}>
                  {c.label}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn--sm" onClick={exportCsv} disabled={shown.length === 0}>
              Export
            </button>
          </div>
        </div>
        <div className={shared.tableWrap}>
          <table className={shared.table}>
            <caption className={shared.srOnly}>Every transaction of {employee.full_name}, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Date (BS)</th>
                <th scope="col">Type</th>
                <th scope="col">Details &amp; remarks</th>
                <th scope="col" className={shared.num}>
                  Earned (+)
                </th>
                <th scope="col" className={shared.num}>
                  Paid (−)
                </th>
                <th scope="col" className={shared.num}>
                  Balance due
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={6} className={shared.empty}>
                    Nothing here yet.
                  </td>
                </tr>
              ) : (
                shown.map((e) => (
                  <Fragment key={e.id}>
                  <tr className={`${e.voided ? shared.voidedRow : e.paid > 0 ? styles.txPaidRow : ""} ${e.payment ? styles.txHasRemarks : ""}`}>
                    <td>
                      <BSDateText value={e.date.bs} />
                      {e.in_progress ? <span className={shared.note}> · so far</span> : null}
                    </td>
                    <td>
                      <span className={styles.txTags}>
                        <span className={styles.txTag} data-type={e.type}>
                          {ENTRY_LABEL[e.type]}
                        </span>
                        {bulkMonths(e) ? (
                          <span className={styles.txTag} data-type="bulk">
                            Bulk · {bulkMonths(e)} months
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td style={{ whiteSpace: "normal", color: "#3e4a52" }}>{e.details}</td>
                    <td className={`${shared.num} ${shared.ok}`}>{e.earned ? `${e.earned < 0 ? "−" : "+"}${formatAmount(Math.abs(e.earned))}` : ""}</td>
                    <td className={`${shared.num} ${shared.danger}`}>
                      {e.voided && e.payment ? (
                        <span className={shared.voidedAmount}>−{formatAmount(e.payment.amount)}</span>
                      ) : e.paid ? (
                        `−${formatAmount(e.paid)}`
                      ) : (
                        ""
                      )}
                    </td>
                    <td className={`${shared.num} ${shared.kvStrong}`}>{formatAmount(e.balance)}</td>
                  </tr>
                  {e.payment ? (
                    // Remarks under the details, spanning to Paid so the System box has room.
                    <tr className={`${styles.txRemarksRow} ${e.paid > 0 ? styles.txPaidRow : ""}`}>
                      <td colSpan={2} />
                      <td colSpan={3} style={{ whiteSpace: "normal" }}>
                        <PaymentRemarks key={`${e.payment.id}-${e.payment.note ?? ""}`} payment={e.payment} months={e.group_months} canEdit={canNote} />
                      </td>
                      <td />
                    </tr>
                  ) : null}
                  </Fragment>
                ))
              )}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3} style={{ textAlign: "left" }}>
                  Totals · {shown.length} entries
                </th>
                <td className={`${shared.num} ${shared.ok}`}>+{formatAmount(earned)}</td>
                <td className={`${shared.num} ${shared.danger}`}>−{formatAmount(paid)}</td>
                <td className={shared.num}>{formatAmount(t.balance)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <span className={styles.ledgerNote}>
          Newest first. Salary is earned on the last day of each BS month (the running month counts up to today); absence
          deductions reduce it, overtime adds to it. Advances and salary payments are paid out. Balance due = everything
          earned − everything paid, up to that row.
        </span>
        <span className={styles.ledgerNote} data-testid="bulk-explainer">
          A bulk payment is one row on its payment date; the grey System remark (written automatically, not editable) shows
          which months it cleared, and anyone can add their own note.
        </span>
      </div>
    </section>
  );
}
