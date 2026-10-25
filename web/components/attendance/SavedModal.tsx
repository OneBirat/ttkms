"use client";

import { useId } from "react";
import { CheckIcon } from "./icons";
import { initials, statusLabel } from "./helpers";
import { photoTint } from "./MarkRow";
import type { EmployeeRef, MarkStatus } from "./types";
import { useDialog } from "./useDialog";
import type { SavedConfirm } from "./useMarkState";
import styles from "./mark.module.css";

export interface SavedModalProps {
  saved: SavedConfirm;
  employee: EmployeeRef;
  onEdit: () => void;
  onChange: (status: MarkStatus) => void;
  /** "Clear mark" (asks first): back to not marked. */
  onClear: () => void;
  onClose: () => void;
}

const NP: Record<MarkStatus, string> = { P: "हाजिर", O: "ओभरटाइम", A: "अनुपस्थित" };

/** Desktop: "Saved as Present / Absent" after a click, with Edit → change to P / O / A. */
export function SavedModal({ saved, employee, onEdit, onChange, onClear, onClose }: SavedModalProps) {
  const titleId = useId();
  const dialog = useDialog(onClose);
  const label = saved.status === "O" ? `Overtime · ${saved.hours} h` : statusLabel(saved.status);
  const changed = saved.previous !== "N" && saved.previous !== saved.status;
  return (
    <div className={styles.otBackdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog.ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.cfmDialog}
        onKeyDown={dialog.onKeyDown}
      >
        <div className={styles.cfmHead}>
          <span aria-hidden="true" className={styles.cfmAvatar} style={{ background: photoTint(employee.id) }}>
            {initials(employee.name)}
          </span>
          <div className={styles.cfmText}>
            <h2 id={titleId} className={styles.cfmName}>
              {employee.name}
            </h2>
            <span className={styles.cfmMeta}>
              {employee.code} · {employee.department_name}
            </span>
          </div>
        </div>
        <div className={styles.cfmBadge} data-status={saved.status}>
          <span className={styles.cfmSavedAs}>
            <CheckIcon size={16} />
            Saved as
          </span>
          <span className={styles.cfmLabel}>{label}</span>
          <span className={styles.cfmNp} lang="ne">
            {NP[saved.status]}
          </span>
        </div>
        {changed ? (
          <span className={styles.cfmChanged}>Changed from {statusLabel(saved.previous)}.</span>
        ) : null}
        {saved.editing ? (
          <div className={styles.cfmEditBox}>
            <span className={styles.cfmEditLabel}>Change to</span>
            <div className={styles.cfmOpts}>
              {(["P", "O", "A"] as MarkStatus[]).map((status) => (
                <button
                  key={status}
                  type="button"
                  className={styles.cfmOpt}
                  aria-pressed={saved.status === status}
                  onClick={() => onChange(status)}
                >
                  {statusLabel(status)}
                </button>
              ))}
              <button type="button" className={styles.cfmOpt} onClick={onClear}>
                Clear mark
              </button>
            </div>
          </div>
        ) : null}
        <div className={styles.otActions}>
          <button type="button" className={styles.otCancel} onClick={onEdit}>
            ✎ Edit
          </button>
          <button
            type="button"
            className={styles.cfmOk}
            data-status={saved.status}
            onClick={onClose}
            data-autofocus=""
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
