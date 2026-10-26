"use client";

import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { errorMessage, type DashboardAttendance, type DashboardPayments, type DashboardToday, type Today } from "@/lib/api";
import { useActiveBranch } from "@/lib/branchContext";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/useApi";
import { DashboardHeader } from "./dashboard/Header";
import { bar, formatRs, initials, moneyTiles, tiles } from "./dashboard/model";
import styles from "./Dashboard.module.css";

/**
 * Dashboard (/) for the ONE active branch (design/dashboard-branch/DashboardBranches.dc.html):
 * "Dashboard · {Branch}", today's date, branch tabs for users with see_other_branches (a tab
 * switches the whole app), the tiles, "Attendance today · {Branch}" and "Payments today ·
 * {Branch}" - all from GET /api/dashboard/today?branch_id= (the branch is in the fetch key).
 * Nothing is ever added up across branches.
 */
export function Dashboard() {
  const { today: sessionToday } = useSession();
  const { branch } = useActiveBranch();
  const todayQuery = useApi<Today>("/api/today");
  const today = todayQuery.data ?? sessionToday;
  const { data, error, loading, reload } = useApi<DashboardToday>(
    branch ? `/api/dashboard/today?branch_id=${branch.id}` : "/api/dashboard/today",
  );

  return (
    <div className={styles.page}>
      <DashboardHeader today={today} />
      {loading && !data ? (
        <p className="muted" role="status">
          Loading…
        </p>
      ) : error ? (
        <EmptyState icon="alert" title="Could not load the dashboard" text={errorMessage(error)}>
          <button type="button" className="btn" onClick={reload}>
            Try again
          </button>
        </EmptyState>
      ) : data ? (
        <BranchView day={data} />
      ) : null}
    </div>
  );
}

export function BranchView({ day }: { day: DashboardToday }) {
  const cards = tiles(day);
  return (
    <>
      {cards.length ? (
        <section aria-label="Today" className={styles.tiles} data-count={cards.length}>
          {cards.map((t) => (
            <Link key={t.key} href={t.href} className={`card ${styles.tile}`} data-tile={t.key}>
              <span className={styles.tileLabel}>{t.label}</span>
              <span className={`mono ${styles.tileValue}`} style={{ color: t.colour }}>
                {t.value}
              </span>
              <span className={styles.tileSub}>{t.sub}</span>
            </Link>
          ))}
        </section>
      ) : null}
      {day.attendance || day.payments ? (
        <div className={styles.cards} data-two={Boolean(day.attendance && day.payments) || undefined}>
          {day.attendance ? <AttendanceCard branch={day.branch.name} a={day.attendance} /> : null}
          {day.payments ? <PaymentsCard branch={day.branch.name} p={day.payments} /> : null}
        </div>
      ) : (
        <EmptyState title="Nothing to show yet" />
      )}
    </>
  );
}

function AttendanceCard({ branch, a }: { branch: string; a: DashboardAttendance }) {
  const { can } = useSession();
  const canOpen = can("manage_employees") || can("salary_advances");
  const parts = bar(a);
  return (
    <section className={`card ${styles.card}`} aria-labelledby="dash-att-h" data-testid="attendance-card">
      <div className={styles.cardHead}>
        <h2 id="dash-att-h" className={styles.cardTitle}>
          Attendance today · {branch}
        </h2>
        <Link href={a.mark_path} className={styles.cardLink}>
          Mark ›
        </Link>
      </div>
      <div className={styles.bar} aria-hidden="true">
        {parts.map((p) => (p.count ? <span key={p.key} style={{ width: `${p.percent}%`, background: p.colour }} /> : null))}
      </div>
      <div className={styles.legend}>
        {parts.map((p) => (
          <span key={p.key} className={styles.legendItem}>
            <span className={styles.dot} data-key={p.key} style={{ background: p.colour }} />
            {p.label}
            <b className="mono">{p.count}</b>
          </span>
        ))}
      </div>
      <div className={styles.notIn}>
        {a.weekly_off ? (
          <span className={styles.notInTitle}>Saturday · weekly off</span>
        ) : (
          <>
            <span className={styles.notInTitle}>Not in yet · {a.not_in.length} staff</span>
            {a.not_in.length === 0 ? <span className={styles.muted}>Everyone is marked ✓</span> : null}
            {a.not_in.map((p) => (
              <div key={p.employee_id} className={styles.person}>
                <span className={styles.avatar}>
                  {p.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- authenticated API image
                    <img src={p.photo_url} alt="" loading="lazy" />
                  ) : (
                    initials(p.name)
                  )}
                </span>
                {canOpen ? (
                  <Link href={`/people/employees/${p.employee_id}`} className={styles.personName}>
                    {p.name}
                  </Link>
                ) : (
                  <span className={styles.personName}>{p.name}</span>
                )}
                <span className={styles.dept}>{p.department ?? ""}</span>
                <span className={styles.notMarked}>Not marked</span>
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  );
}

function PaymentsCard({ branch, p }: { branch: string; p: DashboardPayments }) {
  return (
    <section className={`card ${styles.card}`} aria-labelledby="dash-pay-h" data-testid="payments-card">
      <div className={styles.cardHead}>
        <h2 id="dash-pay-h" className={styles.cardTitle}>
          Payments today · {branch}
        </h2>
        <Link href={p.payments_path} className={styles.cardLink}>
          Payment reports ›
        </Link>
      </div>
      <div className={styles.money}>
        {moneyTiles(p).map((t) => (
          <div key={t.label} className={styles.moneyTile} data-tone={t.tone}>
            <span className={styles.moneyLabel}>{t.label}</span>
            <span className={`mono ${styles.moneyValue}`}>{t.value}</span>
            <span className={styles.moneySub}>{t.sub}</span>
          </div>
        ))}
      </div>
      {p.payments.length === 0 ? (
        <span className={styles.muted}>No payments yet today.</span>
      ) : (
        p.payments.map((x) => (
          <div key={x.payment_id} className={styles.payRow}>
            <span className={styles.payTag} data-kind={x.kind}>
              {x.kind === "advance" ? "Advance" : "Salary"}
            </span>
            <span className={styles.payName}>
              {x.name}
              {x.months > 1 ? <span className={styles.muted}> · {x.months} months</span> : null}
            </span>
            <span className={styles.payMode}>{x.mode}</span>
            <b className="mono">Rs {formatRs(x.amount)}</b>
          </div>
        ))
      )}
    </section>
  );
}
