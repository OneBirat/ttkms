"use client";

import { useState } from "react";
import { PhoneFrame } from "./PhoneFrame";
import { useBranchScope } from "../../_lib/useBranchScope";
import { listBranches, listPayments } from "../../api";
import { formatBsDay } from "@/lib/bs";
import { rangeFor, today } from "../../_lib/months";
import { formatAmount, groupBy, initials } from "../../_lib/helpers";
import type { RegisterTypeFilter } from "../../types";
import { payrollErrorMessage, usePayroll } from "../../_lib/usePayroll";
import styles from "./phone.module.css";

const CHIPS: { value: RegisterTypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "advance", label: "Advances" },
  { value: "salary", label: "Salary" },
];

/** Phone: payment records grouped by day (design PayrollMobile, payments screen). No tiles, no record form. */
export function PhonePayments() {
  const branches = usePayroll(listBranches, []);
  const [type, setType] = useState<RegisterTypeFilter>("all");
  const range = rangeFor("last_3");
  const register = usePayroll(() => listPayments({ ...range, type }), [type]);
  const branchList = branches.data ?? [];
  const { active: activeBranch, picker } = useBranchScope(branchList);
  const rows = (register.data?.rows ?? []).filter((r) => activeBranch === null || r.employee.branch.id === activeBranch);
  const t = today().bs;
  const days = groupBy(rows, (r) => r.payment.date.bs);
  const dayLabel = (bs: string) => {
    const np = formatBsDay(bs, "ne");
    if (bs === t) return `Today · ${np}`;
    return `${np}${bs.slice(0, 4) !== t.slice(0, 4) ? `, ${bs.slice(0, 4)}` : ""}`;
  };

  return (
    <PhoneFrame
      title="Payment records"
      subtitle="Advances & salary paid"
      branch={picker}
    >
      <div className={styles.chips} role="group" aria-label="Type">
        {CHIPS.map((c) => (
          <button key={c.value} type="button" className={styles.chip} aria-pressed={type === c.value} onClick={() => setType(c.value)}>
            {c.label}
          </button>
        ))}
      </div>
      {register.error ? <p className={styles.empty}>{payrollErrorMessage(register.error)}</p> : null}
      {!register.data && !register.error ? <p className={styles.empty}>Loading…</p> : null}
      {days.map((d) => (
        <div key={d.key}>
          <div className={styles.dayHead}>
            <span className={styles.groupTitle} lang="ne">
              {dayLabel(d.key)}
            </span>
            <span className="mono" style={{ color: "var(--color-muted)" }}>
              Rs {formatAmount(d.items.reduce((s, r) => s + r.payment.amount, 0))}
            </span>
          </div>
          <div className={styles.card} style={{ marginTop: 6 }}>
            {d.items.map(({ payment: p, employee: e }) => (
              <div key={p.id} className={styles.payRow}>
                <span className={styles.payAvatar} data-type={p.type}>
                  {initials(e.full_name)}
                </span>
                <span className={styles.txText}>
                  <span className={styles.txLine}>
                    <span className={styles.rowName}>{e.full_name}</span>
                    <span className={styles.txAmount} style={{ color: p.type === "advance" ? "var(--pill-leave-fg)" : "var(--pill-ok-fg)" }}>
                      Rs {formatAmount(p.amount)}
                    </span>
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span className={styles.pill} data-tone={p.type === "advance" ? "advance" : "ok"}>
                      {p.type === "advance" ? "Advance" : "Salary"}
                    </span>
                    <span className={styles.rowSub} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {p.payment_mode.name} · {p.receipt_no}
                    </span>
                  </span>
                  <span className={styles.txBalance}>Recorded by {p.recorded_by}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {register.data && rows.length === 0 ? <p className={styles.empty}>No payments in the last three months.</p> : null}
    </PhoneFrame>
  );
}
