"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { SET_PASSWORD_PATH } from "@/lib/api";
import { useSession } from "@/lib/session";
import styles from "./AppShell.module.css";

/**
 * The approved layout (docs/design/Main.dc.html): a flex-wrap row with the
 * dark sidebar (232px) and the page column; under ~800px the sidebar wraps
 * above the content. Pages render their own header (PageHeader), there is no
 * separate top bar.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, modules, loading, error, refresh, logout } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  // A temporary password must be replaced before any page opens (the API
  // refuses everything but /api/auth/* until then).
  const mustSetPassword = Boolean(user?.must_change_password);
  useEffect(() => {
    if (mustSetPassword) {
      router.replace(`${SET_PASSWORD_PATH}?next=${encodeURIComponent(pathname)}`);
    }
  }, [mustSetPassword, pathname, router]);

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

  if (loading || !user || mustSetPassword) {
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
      <Sidebar user={user} modules={modules} onLogout={() => void logout()} />
      <main id="main" className={styles.main} tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
