"use client";

import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { WidgetRenderer } from "@/components/widgets";
import { errorMessage, type DashboardResponse } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import styles from "./Dashboard.module.css";

export function Dashboard() {
  const { data, error, loading, reload } =
    useApi<DashboardResponse>("/api/dashboard");

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Today across stock, attendance and payroll"
      />

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
            <section className={styles.stats} aria-label="Key figures">
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
            <section className={styles.widgets} aria-label="Modules">
              {data.widgets.map((widget, index) => (
                <WidgetRenderer
                  key={`${widget.module}:${widget.kind}:${index}`}
                  widget={widget}
                />
              ))}
            </section>
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
