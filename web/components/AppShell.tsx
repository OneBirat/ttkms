"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { PhoneDrawer } from "@/components/PhoneDrawer";
import { Sidebar } from "@/components/Sidebar";
import { SET_PASSWORD_PATH, type Module, type User } from "@/lib/api";
import { useSession } from "@/lib/session";
import { ShellProvider, useShell } from "@/lib/shell";
import styles from "./AppShell.module.css";

/**
 * The approved layout (docs/design/Main.dc.html): a flex-wrap row with the
 * dark sidebar (232px) and the page column; under ~800px the sidebar wraps
 * above the content. Under 640px (the phone layouts) the sidebar is replaced
 * by a dark top bar with a menu button that opens the PhoneDrawer - the same
 * links - unless the page renders its own phone header (usePhoneHeader).
 * Pages render their own header (PageHeader), there is no separate top bar
 * on wider screens.
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
    <ShellProvider>
      <ShellFrame user={user} modules={modules} onLogout={() => void logout()}>
        {children}
      </ShellFrame>
    </ShellProvider>
  );
}

function ShellFrame({
  user,
  modules,
  onLogout,
  children,
}: {
  user: User;
  modules: Module[];
  onLogout: () => void;
  children: ReactNode;
}) {
  const { menuOpen, openMenu, closeMenu, ownHeader } = useShell();
  const pathname = usePathname();
  // Navigating closes the drawer (a link in it was followed, or Back was used).
  useEffect(() => {
    closeMenu();
  }, [pathname, closeMenu]);

  return (
    <div className={styles.shell} data-own-header={ownHeader || undefined}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Sidebar user={user} modules={modules} onLogout={onLogout} />
      <header className={styles.phoneBar}>
        <button
          type="button"
          aria-label="Open menu"
          className={styles.menuButton}
          onClick={openMenu}
        >
          <Icon name="menu" size={22} />
        </button>
        <Link href="/" className={styles.phoneBrand}>
          <span className={styles.phoneTile} aria-hidden="true">
            TT
          </span>
          TTK Attendance
        </Link>
      </header>
      <main id="main" className={styles.main} tabIndex={-1}>
        {children}
      </main>
      {menuOpen ? (
        <PhoneDrawer
          user={user}
          modules={modules}
          onClose={closeMenu}
          onLogout={onLogout}
        />
      ) : null}
    </div>
  );
}
