"use client";

import { useId } from "react";
import { initials, statusLabel } from "./helpers";
import { photoTint } from "./MarkRow";
import type { EmployeeRef } from "./types";
import { useDialog } from "./useDialog";
import type { ClearConfirm } from "./useMarkState";
import desk from "./mark.module.css";
import styles from "./mobile.module.css";

export interface ClearMarkModalProps {
  ask: ClearConfirm;
  employee: EmployeeRef;
  /** Saturday: clearing makes the day the weekly off again. */
  weeklyOff: boolean;
  /** Phone: the bottom-sheet look of "Mark as …?"; desktop: the "Saved as" pop-up look. */
  phone: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** "Clear mark?" - the record goes, the day is not marked again (weekly off on a Saturday). */
export function ClearMarkModal({ ask, employee, weeklyOff, phone, onConfirm, onCancel }: ClearMarkModalProps) {
  const titleId = useId();
  const dialog = useDialog(onCancel);
  const note = `Currently ${statusLabel(ask.previous)} — the day will show ${weeklyOff ? "the weekly off" : "not marked"} again.`;
  if (!phone) {
    return (
      <div className={desk.otBackdrop} onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
        <div
          ref={dialog.ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className={desk.cfmDialog}
          onKeyDown={dialog.onKeyDown}
        >
          <div className={desk.cfmHead}>
            <span aria-hidden="true" className={desk.cfmAvatar} style={{ background: photoTint(employee.id) }}>
              {initials(employee.name)}
            </span>
            <div className={desk.cfmText}>
              <h2 id={titleId} className={desk.cfmName}>
                Clear mark?
              </h2>
              <span className={desk.cfmMeta}>
                {employee.name} · {employee.code} · {employee.department_name}
              </span>
            </div>
          </div>
          <span className={desk.cfmChanged}>{note}</span>
          <div className={desk.otActions}>
            <button type="button" className={desk.otCancel} onClick={onCancel} data-autofocus="">
              Cancel
            </button>
            <button type="button" className={desk.cfmOk} data-status="A" onClick={onConfirm}>
              Clear mark
            </button>
          </div>
        </div>
      </div>
    );
  }
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
        <span className={styles.askPrev}>{note}</span>
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
