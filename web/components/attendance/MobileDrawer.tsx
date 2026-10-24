"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Module, User } from "@/lib/api";
import { useDialog } from "./useDialog";
import styles from "./mobile.module.css";

export interface MobileDrawerProps {
  user: User | null;
  /** Sidebar sections from the session (enabled modules, role-filtered). */
  modules: Module[];
  onClose: () => void;
  onLogout: () => void;
}

function isActive(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** Side menu of the phone layout: the main nav from the module registry. */
export function MobileDrawer({ user, modules, onClose, onLogout }: MobileDrawerProps) {
  const pathname = usePathname();
  const dialog = useDialog(onClose);
  const sections = modules.filter((m) => m.nav.length > 0);
  return (
    <div className={styles.drawerWrap}>
      <nav
        ref={dialog.ref}
        aria-label="Main"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={styles.drawer}
        onKeyDown={dialog.onKeyDown}
      >
        <div className={styles.drawerBrand}>
          <span className={styles.brandTile} aria-hidden="true">
            TT
          </span>
          <span className={styles.brandText}>
            <span className={styles.brandName}>TTK</span>
            <span className={styles.brandSub}>
              {user ? `${user.full_name} · ${user.role_label}` : ""}
            </span>
          </span>
          <button type="button" aria-label="Close menu" className={styles.drawerClose} onClick={onClose}>
            ×
          </button>
        </div>
        <Link href="/" className={styles.drawerLink} aria-current={pathname === "/" ? "page" : undefined}>
          Dashboard
        </Link>
        {sections.map((module) => (
          <Fragment key={module.name}>
            <div className={styles.drawerHead}>{module.title}</div>
            {module.nav.map((item) => (
              <Link
                key={item.path}
                href={item.path}
                className={styles.drawerLink}
                aria-current={isActive(pathname, item.path) ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </Fragment>
        ))}
        <button type="button" className={`${styles.drawerLink} ${styles.drawerSignOut}`} onClick={onLogout}>
          Sign out
        </button>
      </nav>
      <div aria-hidden="true" className={styles.drawerBackdrop} onClick={onClose} />
    </div>
  );
}
