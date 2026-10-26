"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { BranchSwitcher } from "@/components/BranchSwitcher";
import { Icon } from "@/components/icons";
import { usePhoneHeader, useShell } from "@/lib/shell";
import styles from "./phone.module.css";

export interface PhoneFrameProps {
  title: string;
  subtitle?: string;
  /** Back link instead of the menu button. */
  backHref?: string;
  /** Show the shell's active-branch switcher (list / report / payments): this frame hides the
   *  shell's phone bar. Never a page-level branch choice. */
  branch?: boolean;
  /** "More actions" (⋮) handler. */
  onMore?: () => void;
  /** Tiles or the month switcher under the title row. */
  headerExtra?: ReactNode;
  children: ReactNode;
}

/**
 * Dark header + scrolling body for the phone screens. The menu button opens
 * the shell's PhoneDrawer (the same links as the sidebar); the frame claims
 * the phone header, so the shell's own bar is hidden while it is mounted.
 */
export function PhoneFrame({ title, subtitle, backHref, branch, onMore, headerExtra, children }: PhoneFrameProps) {
  const { openMenu } = useShell();
  usePhoneHeader();

  return (
    <div className={styles.frame}>
      <header className={styles.header}>
        <div className={styles.headerRow}>
          {backHref ? (
            <Link href={backHref} aria-label="Back" className={styles.iconButton}>
              ‹
            </Link>
          ) : (
            <button type="button" aria-label="Open menu" className={styles.iconButton} onClick={openMenu}>
              <Icon name="menu" size={22} />
            </button>
          )}
          <div className={styles.titleBlock}>
            <span className={styles.title}>{title}</span>
            {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
          </div>
          {branch ? <BranchSwitcher variant="bar" /> : null}
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
    </div>
  );
}
