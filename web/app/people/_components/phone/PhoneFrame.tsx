"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { usePhoneHeader, useShell } from "@/lib/shell";
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

/**
 * Dark header + scrolling body for the phone screens. The menu button opens
 * the shell's PhoneDrawer (the same links as the sidebar); the frame claims
 * the phone header, so the shell's own bar is hidden while it is mounted.
 */
export function PhoneFrame({ title, subtitle, backHref, branch, onMore, headerExtra, children }: PhoneFrameProps) {
  const { openMenu } = useShell();
  usePhoneHeader();
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
            <button type="button" aria-label="Open menu" className={styles.iconButton} onClick={openMenu}>
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
                {branch.value === null ? <option value="">Loading…</option> : null}
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
    </div>
  );
}
