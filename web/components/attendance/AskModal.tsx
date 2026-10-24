"use client";

import { useId } from "react";
import { initials, statusLabel } from "./helpers";
import type { EmployeeRef } from "./types";
import { useDialog } from "./useDialog";
import type { AskConfirm } from "./useMarkState";
import styles from "./mobile.module.css";

export interface AskModalProps {
  ask: AskConfirm;
  employee: EmployeeRef;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Phone: "Mark as Present?" / "Mark as Absent?" before the save. */
export function AskModal({ ask, employee, onConfirm, onCancel }: AskModalProps) {
  const titleId = useId();
  const dialog = useDialog(onCancel);
  const absent = ask.status === "A";
  const title = absent ? "Mark as Absent?" : "Mark as Present?";
  const changes = ask.previous !== "N" && ask.previous !== ask.status;
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
              {title}
            </h2>
            <span className={styles.askMeta}>
              {employee.name} · {employee.code} · {employee.department_name}
            </span>
          </div>
          <button type="button" aria-label="Cancel" className={styles.askClose} onClick={onCancel}>
            ×
          </button>
        </div>
        <div className={styles.askBig} data-status={ask.status}>
          <span className={styles.askBigTitle}>{title}</span>
          <span lang="ne" className={styles.askBigNp}>
            {absent ? "अनुपस्थित" : "हाजिर"}
          </span>
        </div>
        {changes ? (
          <span className={styles.askPrev}>Currently {statusLabel(ask.previous)} — this will change it.</span>
        ) : null}
        <div className={styles.twoBtns}>
          <button type="button" className={styles.secondaryBtn} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={styles.askConfirm} data-status={ask.status} onClick={onConfirm} data-autofocus="">
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
