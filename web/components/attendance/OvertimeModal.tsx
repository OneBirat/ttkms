"use client";

import { useId } from "react";
import { OT_MAX, OT_MIN } from "./types";
import { useDialog } from "./useDialog";
import styles from "./mark.module.css";

const QUICK_HOURS = [1, 2, 3, 4, 5, 6, 7, 8];

export interface OvertimeModalProps {
  name: string;
  hours: number;
  onHours: (hours: number) => void;
  onCancel: () => void;
  onSave: () => void;
}

/** "Overtime hours" pop-up: big hours display, quick buttons 1–8 h, −/+ in 1-hour steps (1–12). */
export function OvertimeModal({ name, hours, onHours, onCancel, onSave }: OvertimeModalProps) {
  const titleId = useId();
  const dialog = useDialog(onCancel);
  return (
    <div className={styles.otBackdrop} onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        ref={dialog.ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.otDialog}
        onKeyDown={dialog.onKeyDown}
      >
        <div className={styles.otHead}>
          <div>
            <h2 id={titleId} className={styles.otTitle}>
              Overtime hours
            </h2>
            <span className={styles.otSub}>{name} · marked present + overtime</span>
          </div>
          <button type="button" aria-label="Cancel" className={styles.otClose} onClick={onCancel}>
            ×
          </button>
        </div>
        <div className={styles.otDisplay} aria-live="polite">
          <span className={styles.otValue}>{hours}</span>
          <span className={styles.otUnit}>hours</span>
        </div>
        <div role="radiogroup" aria-label="Hours" className={styles.otChips}>
          {QUICK_HOURS.map((h) => (
            <button
              key={h}
              type="button"
              role="radio"
              aria-checked={hours === h}
              className={styles.otChip}
              data-autofocus={hours === h ? "" : undefined}
              onClick={() => onHours(h)}
            >
              {h} h
            </button>
          ))}
        </div>
        <div className={styles.otFine}>
          <span>Fine-tune</span>
          <button
            type="button"
            aria-label="One hour less"
            className={styles.otStep}
            onClick={() => onHours(hours - 1)}
            disabled={hours <= OT_MIN}
          >
            −
          </button>
          <button
            type="button"
            aria-label="One hour more"
            className={styles.otStep}
            onClick={() => onHours(hours + 1)}
            disabled={hours >= OT_MAX}
          >
            +
          </button>
          <span className={styles.otFineHint}>1-hour steps, max {OT_MAX} h</span>
        </div>
        <div className={styles.otActions}>
          <button type="button" className={styles.otCancel} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={styles.otSave} onClick={onSave}>
            Save {hours} h
          </button>
        </div>
      </div>
    </div>
  );
}
