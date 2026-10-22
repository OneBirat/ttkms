"use client";

import { DateLine } from "@/components/DateLine";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { WidgetRenderer } from "@/components/widgets";
import { errorMessage, type DashboardResponse } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/useApi";
import styles from "./Dashboard.module.css";

/**
 * Dashboard shell (docs/design/Main.dc.html): page header with today's date,
 * the summary stat-card row, then each module's widgets stacked full-width in
 * registry order. Page actions (e.g. "Record purchase") belong to the modules
 * and are added through their widgets.
 */
export function Dashboard() {
  const { today } = useSession();
  const { data, error, loading, reload } =
    useApi<DashboardResponse>("/api/dashboard");

  return (
    <>
      <PageHeader title="Dashboard" meta={<DateLine today={today} />} />

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
      ) : data ? (
        <>
          {data.stats.length > 0 ? (
            <section className={styles.stats} aria-label="Summary">
              {data.stats.map((stat) => (
                <StatCard
                  key={stat.label}
                  label={stat.label}
                  value={stat.value}
                  hint={stat.hint}
                  tone={stat.tone}
                  href={stat.href}
                />
              ))}
            </section>
          ) : null}
          {data.widgets.length > 0 ? (
            <div className={styles.widgets}>
              {data.widgets.map((widget, index) => (
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
      ) : null}

      <footer className={styles.footer}>
        <span>Export demo:</span>{" "}
        <a href="/api/core/export-demo.pdf">PDF</a>
        <span aria-hidden="true"> · </span>
        <a href="/api/core/export-demo.xlsx">Excel</a>
      </footer>
    </>
  );
}
