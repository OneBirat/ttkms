"use client";

import { formatBsShort } from "@/lib/bs";
import { monthLabel } from "../_lib/months";
import { formatRs } from "../_lib/helpers";
import { monthsText, paymentEntries } from "../_lib/settle";
import type { AccountSummary } from "../types";
import styles from "./payroll.module.css";
import own from "./employees.module.css";

/**
 * Right side of Give advance and Pay salary (design Employees.dc.html): the last six payments,
 * advances of the last four months, balance due over every month, "Open full ledger ›".
 */
export function RecentPaymentsPanel({
  summary,
  highlightIds = [],
  onOpenLedger,
  footnote = true,
}: {
  summary: AccountSummary | null;
  /** Just saved: highlighted. */
  highlightIds?: number[];
  onOpenLedger: () => void;
  /** "Advances count toward {month}…" under the button. */
  footnote?: boolean;
}) {
  const s = summary;
  // A salary payment split over months is one entry ("Bhadra – Ashwin").
  const recent = paymentEntries(s?.recent ?? []).slice(0, 6);
  return (
    <aside className={own.advanceSide} aria-label="Recent payments">
      <div className={styles.between}>
        <h3 style={{ fontSize: 15, fontWeight: 700 }}>Recent payments</h3>
        <span className={styles.note}>last {recent.length}</span>
      </div>
      <div className={styles.recentList}>
        {recent.length === 0 ? <span className={styles.note}>No payments yet.</span> : null}
        {recent.map(({ payment: p, months, ids }) => (
          <div key={p.id} className={styles.recentRow} data-new={ids.some((id) => highlightIds.includes(id))}>
            <span className={styles.recentTag} data-type={p.kind}>
              {p.kind === "advance" ? "Advance" : "Salary"}
            </span>
            <span className={styles.recentText}>
              <span className={styles.recentTitle}>
                {formatBsShort(p.date.bs)} · {monthsText(months)}
              </span>
              <span className={styles.recentSub}>
                {p.payment_mode.name}
                {p.reference ? ` · ${p.reference}` : ""}
                {p.note ? ` · ${p.note}` : ""} · by {p.recorded_by}
              </span>
            </span>
            <span className={styles.recentAmount}>{formatRs(p.amount)}</span>
          </div>
        ))}
      </div>
      <div className={own.advanceTotals}>
        <div>
          <span className={styles.tileLabel} style={{ color: "var(--color-muted)" }}>
            Advances · last 4 months
          </span>
          <span className={styles.tileValue} style={{ color: "var(--pill-leave-fg)" }}>
            {s ? formatRs(s.advances_recent) : "…"}
          </span>
        </div>
        <div>
          <span className={styles.tileLabel} style={{ color: "var(--color-muted)" }}>
            Balance due (all months)
          </span>
          <span className={styles.tileValue} style={{ color: "var(--pill-danger-fg)" }}>
            {s ? formatRs(s.balance_due) : "…"}
          </span>
        </div>
      </div>
      <button type="button" className="btn" style={{ color: "var(--color-primary)", fontWeight: 600 }} onClick={onOpenLedger}>
        Open full ledger ›
      </button>
      {s && footnote ? <span className={styles.note}>Advances count toward {monthLabel(s.month)}; nothing is recovered later.</span> : null}
    </aside>
  );
}
