"use client";

import { useId } from "react";
import { FaceContent } from "./Face";
import { changeText, REASON_MAX, REASON_MIN } from "./lock";
import { photoTint } from "./MarkRow";
import type { EmployeeRef } from "./types";
import { useDialog } from "./useDialog";
import type { OverrideAsk } from "./useMarkState";
import styles from "./lock.module.css";

export interface OverrideSheetProps {
  ask: OverrideAsk;
  /** null for a bulk change. */
  employee: EmployeeRef | null;
  /** "Kartik 14, 2083" */
  dateLabel: string;
  weeklyOff: boolean;
  /** Phone: a bottom sheet; desktop: a centred dialog. */
  phone: boolean;
  /** Shown above the reason when the change touches a month that is already paid. */
  warning?: string | null;
  onReason: (reason: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The super admin's confirm sheet for a change on a past day: old → new, the required reason
 * (at least 5 characters, kept in the history), and "Change as super admin".
 */
export function OverrideSheet({
  ask,
  employee,
  dateLabel,
  weeklyOff,
  phone,
  warning,
  onReason,
  onConfirm,
  onCancel,
}: OverrideSheetProps) {
  const titleId = useId();
  const reasonId = useId();
  const hintId = useId();
  const dialog = useDialog(onCancel);
  const change = changeText(ask.previous, ask.previousHours, ask.status, ask.hours, weeklyOff);
  const [from, to] = change.split(" → ");
  return (
    <div
      className={styles.ovBackdrop}
      data-phone={phone || undefined}
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        ref={dialog.ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.ovDialog}
        onKeyDown={dialog.onKeyDown}
      >
        {phone ? <span aria-hidden="true" className={styles.ovHandle} /> : null}
        <div className={styles.ovHead}>
          {employee ? (
            <span aria-hidden="true" className={styles.ovAvatar} style={{ background: photoTint(employee.id) }}>
              <FaceContent employee={employee} />
            </span>
          ) : null}
          <div className={styles.ovHeadText}>
            <h2 id={titleId} className={styles.ovTitle}>
              Change past attendance
            </h2>
            <span className={styles.ovMeta}>
              {employee
                ? `${employee.name} · ${employee.code} · ${employee.department_name}`
                : (ask.bulk?.scope ?? "")}
            </span>
          </div>
        </div>
        <div className={styles.ovChange}>
          <span className={styles.ovDate}>{dateLabel}</span>
          <span className={styles.ovArrow} aria-label={change}>
            <span className={styles.ovOld}>{from}</span>
            <span aria-hidden="true">→</span>
            <span className={styles.ovNew}>{to}</span>
          </span>
        </div>
        {warning ? (
          <p role="note" className={styles.ovWarning}>
            {warning}
          </p>
        ) : null}
        <div className={styles.ovField}>
          <label htmlFor={reasonId} className={styles.ovLabel}>
            Reason <span className={styles.ovReq}>(required)</span>
          </label>
          <textarea
            id={reasonId}
            className={styles.ovReason}
            rows={3}
            maxLength={REASON_MAX}
            value={ask.reason}
            placeholder="Why is this day being changed?"
            aria-describedby={hintId}
            aria-invalid={ask.error ? true : undefined}
            disabled={ask.busy}
            onChange={(e) => onReason(e.target.value)}
            data-autofocus=""
          />
          {ask.error ? (
            <span id={hintId} role="alert" className={styles.ovError}>
              {ask.error}
            </span>
          ) : (
            <span id={hintId} className={styles.ovHint}>
              At least {REASON_MIN} characters. It is saved in the history with your name.
            </span>
          )}
        </div>
        <div className={styles.ovActions}>
          <button type="button" className={styles.ovCancel} disabled={ask.busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={styles.ovConfirm} disabled={ask.busy} onClick={onConfirm}>
            {ask.busy ? "Saving…" : "Change as super admin"}
          </button>
        </div>
      </div>
    </div>
  );
}
