"use client";

import type { ReactNode } from "react";
import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";
import { useSession } from "@/lib/session";
import styles from "./AppShell.module.css";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, modules, today, loading, error, refresh, logout } =
    useSession();

  if (error && !user) {
    return (
      <div className={styles.status} role="alert">
        <p className={styles.statusTitle}>Could not load your session</p>
        <p className="muted">{error}</p>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void refresh()}
        >
          Try again
        </button>
      </div>
    );
  }

  if (loading || !user) {
    return (
      <div className={styles.status} role="status" aria-live="polite">
        <span className={styles.spinner} aria-hidden="true" />
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Sidebar user={user} modules={modules} />
      <div className={styles.column}>
        <Header today={today} user={user} onLogout={() => void logout()} />
        <main id="main" className={styles.main} tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
