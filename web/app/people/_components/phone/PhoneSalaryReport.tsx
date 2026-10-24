"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/lib/session";
import { PhoneFrame } from "./PhoneFrame";
import { currentMonth, getSalaryReport, listBranches, listMonths } from "../../api";
import { formatAdRange } from "@/lib/bs";
import { addMonths, compareMonths, monthEnd, monthLabel, monthStart, sameMonth } from "../../_lib/months";
import { formatAmount } from "../../_lib/helpers";
import { payrollErrorMessage, usePayroll } from "../../_lib/usePayroll";
import styles from "./phone.module.css";
import shared from "../payroll.module.css";

type Filter = "all" | "due" | "paid";

/** Phone: salary report for one BS month (design PayrollMobile, report screen). */
export function PhoneSalaryReport() {
  const router = useRouter();
  const { user } = useSession();
  const branches = usePayroll(listBranches, []);
  const months = usePayroll(listMonths, []);
  const [branch, setBranch] = useState<number | null>(null);
  const [month, setMonth] = useState(currentMonth());
  const [filter, setFilter] = useState<Filter>("all");
  const report = usePayroll(() => getSalaryReport(month), [month.bs_year, month.bs_month]);
  const branchList = branches.data ?? [];
  const activeBranch = branch ?? branchList[0]?.id ?? null;
  const rows = (report.data?.rows ?? []).filter((r) => activeBranch === null || r.employee.branch.id === activeBranch);
  const shown = rows.filter((r) => (filter === "all" ? true : filter === "due" ? r.ledger.due > 0 : r.ledger.due === 0));
  const oldest = months.data?.[months.data.length - 1] ?? null;
  const running = sameMonth(month, currentMonth());
  const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + pick(r), 0);

  return (
    <PhoneFrame
      title="Salary report"
      subtitle={`${branchList.find((b) => b.id === activeBranch)?.name ?? ""} · ${rows.length} staff`}
      branch={user?.role === "admin" ? { value: activeBranch, options: branchList, onChange: setBranch } : null}
      headerExtra={
        <div className={styles.monthNav}>
          <button type="button" aria-label="Previous month" className={styles.monthNavButton} disabled={Boolean(oldest && compareMonths(month, oldest) <= 0)} onClick={() => setMonth(addMonths(month, -1))}>
            ‹
          </button>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span className={styles.monthNp}>{monthLabel(month, "ne")}</span>
            <span className={styles.subtitle}>
              {monthLabel(month)}
              {running ? " · so far" : ""} · {formatAdRange(monthStart(month).ad, running ? monthEnd(month).ad : monthEnd(month).ad)}
            </span>
          </div>
          <button type="button" aria-label="Next month" className={styles.monthNavButton} disabled={running} onClick={() => setMonth(addMonths(month, 1))}>
            ›
          </button>
        </div>
      }
    >
      <div className={styles.repTiles}>
        <div className={shared.tile} data-tone="plain">
          <span className={shared.tileLabel}>Total net</span>
          <span className={shared.tileValue}>Rs {formatAmount(sum((r) => r.ledger.net))}</span>
        </div>
        <div className={shared.tile} data-tone="ok">
          <span className={shared.tileLabel}>Paid</span>
          <span className={shared.tileValue}>Rs {formatAmount(sum((r) => r.ledger.paid))}</span>
        </div>
        <div className={shared.tile} data-tone="danger">
          <span className={shared.tileLabel}>Still due</span>
          <span className={shared.tileValue}>Rs {formatAmount(sum((r) => r.ledger.due))}</span>
        </div>
      </div>
      <div className={styles.chips} role="group" aria-label="Show">
        {(
          [
            ["all", "All", rows.length],
            ["due", "Due", rows.filter((r) => r.ledger.due > 0).length],
            ["paid", "Paid", rows.filter((r) => r.ledger.due === 0).length],
          ] as [Filter, string, number][]
        ).map(([value, label, n]) => (
          <button key={value} type="button" className={styles.chip} aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {label} <b>{n}</b>
          </button>
        ))}
      </div>
      {report.error ? <p className={styles.empty}>{payrollErrorMessage(report.error)}</p> : null}
      {!report.data && !report.error ? <p className={styles.empty}>Loading…</p> : null}
      {report.data ? (
        <div className={styles.card}>
          {shown.length === 0 ? <p className={styles.empty}>Nobody matches.</p> : null}
          {shown.map(({ employee: e, ledger: l }) => (
            <button key={e.id} type="button" className={styles.row} onClick={() => router.push(`/people/employees/${e.id}`)}>
              <span className={styles.rowText}>
                <span className={styles.rowName} style={{ fontSize: 14 }}>
                  {e.full_name}
                </span>
                <span className={styles.rowSub}>
                  {e.department?.name ?? "—"} · {l.attendance.absent ? `${l.attendance.absent} d absent` : "full month"} · OT {l.attendance.overtime_hours} h
                </span>
              </span>
              <span className={styles.rowRight}>
                <span className="mono" style={{ fontSize: 14, fontWeight: 700 }}>
                  Rs {formatAmount(l.net)}
                </span>
                <span className={styles.pill} data-tone={l.due > 0 ? "danger" : "ok"}>
                  {l.due > 0 ? `Due ${formatAmount(l.due)}` : "Paid"}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <span className={styles.pad} style={{ fontSize: 12, color: "var(--color-muted)" }}>
        Net = salary + overtime − absence. Tap a person to open their account.
      </span>
    </PhoneFrame>
  );
}
