"use client";

import { useBranch, withBranch } from "@/lib/branchContext";
import { DateLine } from "@/components/DateLine";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard, type StatCardProps } from "@/components/ui/StatCard";
import { WidgetRenderer } from "@/components/widgets";
import { errorMessage, type DashboardResponse, type Today, type TodayCounts } from "@/lib/api";
import { enabledOnly } from "@/lib/modules";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/useApi";
import styles from "./Dashboard.module.css";

/**
 * The four headline cards from GET /api/today `counts`: Present today (P + O),
 * Overtime today (O, with the hours), Absent · not marked, Paid today. A card
 * whose module is not enabled is left out (its fields are null).
 */
export function statCards(counts: TodayCounts | null): StatCardProps[] {
  if (!counts) return [];
  const cards: StatCardProps[] = [];
  if (counts.present !== null && counts.overtime !== null) {
    const total = counts.total ?? 0;
    cards.push({
      label: "Present today",
      value: counts.present + counts.overtime,
      hint: total ? `of ${total} staff` : null,
      tone: "ok",
      href: "/attendance/mark",
    });
    cards.push({
      label: "Overtime today",
      value: counts.overtime,
      hint: counts.overtime_hours ? `${counts.overtime_hours} h in total` : "no overtime yet",
      tone: "leave",
      href: "/attendance/mark",
    });
    const absent = counts.absent ?? 0;
    const notMarked = counts.not_marked ?? 0;
    cards.push({
      label: "Absent · not marked",
      value: absent + notMarked,
      hint: `${absent} absent · ${notMarked} not marked`,
      tone: absent + notMarked > 0 ? "danger" : "neutral",
      href: "/attendance/mark",
    });
  }
  if (counts.paid_today !== null) {
    const n = counts.payments_today ?? 0;
    cards.push({
      label: "Paid today",
      value: counts.paid_today,
      hint: `Rs · ${n} ${n === 1 ? "payment" : "payments"}`,
      tone: "neutral",
      href: "/people/payments",
    });
  }
  return cards;
}

/**
 * Dashboard (docs/design/Main.dc.html): page header with today's date, the
 * stat row (from /api/today), then the modules' cards - "Attendance today" and
 * "Payments today" - stacked full-width in sidebar order. Cards of a module
 * that is not in ENABLED_MODULES are never rendered (the API does not send
 * them either).
 */
export function Dashboard() {
  const { today: sessionToday, enabled } = useSession();
  // Everything here is the ONE active branch (the server scopes /api/today and the cards).
  const { branch } = useBranch();
  const todayQuery = useApi<Today>("/api/today");
  const today = todayQuery.data ?? sessionToday;
  const { data, error, loading, reload } = useApi<DashboardResponse>("/api/dashboard");
  const widgets = data ? enabledOnly(data.widgets, enabled) : [];
  const cards = statCards(todayQuery.data?.counts ?? null);

  return (
    <>
      <PageHeader title={withBranch("Dashboard", branch)} meta={<DateLine today={today} />} />

      {cards.length > 0 ? (
        <section className={styles.stats} aria-label="Today">
          {cards.map((card) => (
            <StatCard key={card.label} {...card} />
          ))}
        </section>
      ) : null}

      {loading ? (
        <p className="muted" role="status">
          Loading…
        </p>
      ) : error ? (
        <EmptyState
          icon="alert"
          title="Could not load the dashboard"
          text={errorMessage(error)}
        >
          <button type="button" className="btn" onClick={reload}>
            Try again
          </button>
        </EmptyState>
      ) : widgets.length > 0 ? (
        <div className={styles.widgets}>
          {widgets.map((widget, index) => (
            <WidgetRenderer
              key={`${widget.module}:${widget.kind}:${index}`}
              widget={widget}
            />
          ))}
        </div>
      ) : (
        <EmptyState title="Nothing to show yet" />
      )}
    </>
  );
}
