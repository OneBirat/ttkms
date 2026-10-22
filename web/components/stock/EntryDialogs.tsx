"use client";

import { useEffect, useRef } from "react";
import { Warning } from "./EntryIcons";
import { OTHER_TYPE, switchBlockedNp, TYPE_TEXT } from "./entryLogic";
import type { EntryType } from "./types";
import styles from "./entry.module.css";

/**
 * Minimal dialog behaviour for the entry pop-ups: focus the first control on
 * open, Escape calls onClose, focus returns to the opener afterwards.
 */
export function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("button, [href], input, [tabindex]:not([tabindex='-1'])");
    (first ?? ref.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [open]);
  return ref;
}

export interface SwitchDialogProps {
  /** The type the user asked for; null = closed. */
  to: EntryType | null;
  rowCount: number;
  /** "row" on desktop, "item" on the phone. */
  noun: "row" | "item";
  onKeep: () => void;
  onClear: () => void;
}

/** "Can't switch to Consumption — you have N unsaved purchase row(s)." */
export function SwitchDialog({ to, rowCount, noun, onKeep, onClear }: SwitchDialogProps) {
  const ref = useDialog(to !== null, onKeep);
  if (!to) return null;
  const from = OTHER_TYPE[to];
  return (
    <div className={styles.backdrop}>
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sw-h"
        aria-describedby="sw-d"
        className={styles.switchDialog}
        tabIndex={-1}
      >
        <span className={styles.warnIcon}>
          <Warning size={28} strokeWidth={2.2} />
        </span>
        <h2 id="sw-h" className={styles.switchTitle}>
          Can&apos;t switch to {TYPE_TEXT[to].label}
        </h2>
        <p id="sw-d" className={styles.switchText}>
          You have {rowCount} unsaved {TYPE_TEXT[from].lower} {noun}(s). Save them first, or clear them to switch.
        </p>
        <p className={styles.switchNp} lang="ne">
          {switchBlockedNp(from)}
        </p>
        <div className={styles.switchButtons}>
          <button type="button" className={styles.keepButton} onClick={onKeep}>
            Keep editing
          </button>
          <button type="button" className={styles.clearSwitchButton} onClick={onClear}>
            Clear &amp; switch
          </button>
        </div>
      </div>
    </div>
  );
}
