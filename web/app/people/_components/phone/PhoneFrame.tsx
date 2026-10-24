"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { useSession } from "@/lib/session";
import type { Branch } from "../../types";
import styles from "./phone.module.css";

export interface PhoneFrameProps {
  title: string;
  subtitle?: string;
  /** Back link instead of the menu button. */
  backHref?: string;
  /** Branch pill (admins on list / report / payments). */
  branch?: { value: number | null; options: Branch[]; onChange: (id: number) => void } | null;
  /** "More actions" (⋮) handler. */
  onMore?: () => void;
  /** Tiles or the month switcher under the title row. */
  headerExtra?: ReactNode;
  children: ReactNode;
}

/** Dark header + drawer menu + scrolling body for the phone screens. */
export function PhoneFrame({ title, subtitle, backHref, branch, onMore, headerExtra, children }: PhoneFrameProps) {
  const { user, modules, logout } = useSession();
  const pathname = usePathname();
  const [menu, setMenu] = useState(false);
  const branchName = branch?.options.find((b) => b.id === branch.value)?.name ?? "";

  return (
    <div className={styles.frame}>
      <header className={styles.header}>
        <div className={styles.headerRow}>
          {backHref ? (
            <Link href={backHref} aria-label="Back" className={styles.iconButton}>
              ‹
            </Link>
          ) : (
            <button type="button" aria-label="Open menu" className={styles.iconButton} onClick={() => setMenu(true)}>
              <Icon name="menu" size={22} />
            </button>
          )}
          <div className={styles.titleBlock}>
            <span className={styles.title}>{title}</span>
            {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
          </div>
          {branch ? (
            <label className={styles.branchPill}>
              {branchName.replace(/ branch$/i, "") || "Branch"}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
              <select aria-label="Branch" value={branch.value ?? ""} onChange={(e) => branch.onChange(Number(e.target.value))}>
                {branch.options.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {onMore ? (
            <button type="button" aria-label="More actions" className={styles.iconButton} onClick={onMore}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="12" cy="5" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="19" r="2" />
              </svg>
            </button>
          ) : null}
        </div>
        {headerExtra}
      </header>

      <div className={styles.body}>{children}</div>

      {menu ? (
        <div className={styles.drawerWrap}>
          <nav aria-label="Menu" className={styles.drawer}>
            <div className={styles.drawerBrand}>
              <span className={styles.drawerTile} aria-hidden="true">
                TT
              </span>
              <span style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                <span className={styles.drawerName}>TTK Attendance</span>
                <span className={styles.drawerSub}>
                  {user?.full_name} · {user?.role_label}
                </span>
              </span>
              <button type="button" aria-label="Close menu" className={styles.drawerClose} onClick={() => setMenu(false)}>
                ×
              </button>
            </div>
            <Link href="/" className={styles.drawerLink} aria-current={pathname === "/" ? "page" : undefined}>
              Dashboard
            </Link>
            {modules
              .filter((m) => m.nav.length > 0)
              .map((m) => (
                <Fragment key={m.name}>
                  <div className={styles.drawerHead}>{m.title}</div>
                  {m.nav.map((item) => (
                    <Link
                      key={item.path}
                      href={item.path}
                      className={styles.drawerLink}
                      aria-current={pathname === item.path || pathname.startsWith(`${item.path}/`) ? "page" : undefined}
                      onClick={() => setMenu(false)}
                    >
                      {item.label === "Payments" ? "Payment records" : item.label}
                    </Link>
                  ))}
                </Fragment>
              ))}
            <button type="button" className={styles.drawerSignOut} onClick={() => void logout()}>
              Sign out
            </button>
          </nav>
          <div aria-hidden="true" className={styles.drawerBackdrop} onClick={() => setMenu(false)} />
        </div>
      ) : null}
    </div>
  );
}
