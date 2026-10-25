"use client";

import { useId } from "react";
import { initials, statusLabel } from "./helpers";
import type { EmployeeRef } from "./types";
import { useDialog } from "./useDialog";
import type { ClearConfirm } from "./useMarkState";
import styles from "./mobile.module.css";

export interface ClearMarkModalProps {
  ask: ClearConfirm;
  employee: EmployeeRef;
  /** Saturday: clearing makes the day the weekly off again. */
  weeklyOff: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** "Clear mark?" - the record goes, the day is not marked again (weekly off on a Saturday). Both layouts. */
export function ClearMarkModal({ ask, employee, weeklyOff, onConfirm, onCancel }: ClearMarkModalProps) {
  const titleId = useId();
  const dialog = useDialog(onCancel);
  return (
    <div className={styles.askBackdrop} onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        ref={dialog.ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.askDialog}
        onKeyDown={dialog.onKeyDown}
      >
        <div className={styles.askHead}>
          <span className={styles.askAvatar}>{initials(employee.name)}</span>
          <div className={styles.askText}>
            <h2 id={titleId} className={styles.askTitle}>
              Clear mark?
            </h2>
            <span className={styles.askMeta}>
              {employee.name} · {employee.code} · {employee.department_name}
            </span>
          </div>
          <button type="button" aria-label="Cancel" className={styles.askClose} onClick={onCancel}>
            ×
          </button>
        </div>
        <span className={styles.askPrev}>
          Currently {statusLabel(ask.previous)} — the day will show {weeklyOff ? "the weekly off" : "not marked"} again.
        </span>
        <div className={styles.twoBtns}>
          <button type="button" className={styles.secondaryBtn} onClick={onCancel} data-autofocus="">
            Cancel
          </button>
          <button type="button" className={styles.askConfirm} data-status="A" onClick={onConfirm}>
            Clear mark
          </button>
        </div>
      </div>
    </div>
  );
}
