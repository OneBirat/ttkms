"use client";

import { formatBs } from "@/lib/bs";
import { lastPayments } from "../_lib/account";
import { monthLabel } from "../_lib/months";
import { monthsText } from "../_lib/settle";
import { formatRs } from "../_lib/helpers";
import type { MonthLedger } from "../types";
import styles from "./account.module.css";
import shared from "./payroll.module.css";

/** Salary tab, right card: the six most recent non-voided payments, newest first. */
export function LastPaymentsCard({ ledger, onOpenLedger }: { ledger: MonthLedger[]; onOpenLedger: () => void }) {
  const payments = lastPayments(ledger, 6);
  return (
    <section aria-labelledby="last-pay-h" className={`card ${styles.payCard}`} data-testid="last-payments">
      <div className={shared.between}>
        <h3 id="last-pay-h" className={shared.cardTitle}>
          Last 6 payments
        </h3>
        <button type="button" className={styles.calLink} onClick={onOpenLedger}>
          Open ledger ›
        </button>
      </div>
      {payments.length === 0 ? (
        <p className={shared.muted} style={{ fontSize: 13 }}>
          No payments yet.
        </p>
      ) : (
        <ul className={styles.payList}>
          {payments.map(({ payment: p, months }) => (
            <li key={p.id} className={styles.payRow} data-receipt={p.receipt_no}>
              <span className={styles.payDate}>{formatBs(p.date.bs)}</span>
              <span className={styles.payWhat}>
                <span className={p.kind === "advance" ? shared.pillAdvance : shared.pillSalary}>{p.kind === "advance" ? "Advance" : "Salary"}</span>
                <span className={styles.payFor}>
                  for {monthsText(months, monthLabel)} · {p.payment_mode.name}
                </span>
              </span>
              <span className={`${shared.num} ${shared.kvStrong} ${styles.payAmount}`}>{formatRs(p.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
