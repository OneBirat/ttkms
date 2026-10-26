"use client";

import { FaceContent } from "./Face";
import { useId } from "react";
import { draftText, type Draft } from "./helpers";
import type { EmployeeRef } from "./types";
import { useDialog } from "./useDialog";
import styles from "./mobile.module.css";

export interface ActionSheetProps {
  employee: EmployeeRef;
  current: Draft;
  onOvertime: () => void;
  onPayments: () => void;
  onCalendar: () => void;
  onChange: (status: "P" | "A") => void;
  /** "Clear mark" (asks first); only offered when the day is marked. */
  onClear: () => void;
  /** Without salary_advances there is no "View payments". */
  canPay: boolean;
  onClose: () => void;
}

/** Phone ⋮ menu: Add overtime · View payments · View attendance calendar · Change status · Clear mark. */
export function ActionSheet({ employee, current, onOvertime, onPayments, onCalendar, onChange, onClear, canPay, onClose }: ActionSheetProps) {
  const titleId = useId();
  const dialog = useDialog(onClose);
  const status = current.status ?? "N";
  return (
    <div className={styles.actWrap}>
      <div aria-hidden="true" className={styles.actBackdrop} onClick={onClose} />
      <section
        ref={dialog.ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.actSheet}
        onKeyDown={dialog.onKeyDown}
      >
        <span aria-hidden="true" className={styles.sheetHandle} />
        <div className={styles.actHead}>
          <span className={styles.actAvatar} data-status={status}>
            <FaceContent employee={employee} />
          </span>
          <div className={styles.actText}>
            <h2 id={titleId} className={styles.actName}>
              {employee.name}
            </h2>
            <span className={styles.actMeta}>
              {employee.code} · {employee.department_name}
            </span>
          </div>
          <span className={styles.badge} data-status={status}>
            {draftText(current)}
          </span>
        </div>
        <div className={styles.actList}>
          <button type="button" className={`${styles.actItem} ${styles.actItemOt}`} onClick={onOvertime} data-autofocus="">
            <span className={`${styles.actIcon} ${styles.actIconOt}`}>+</span>
            <span className={styles.actItemText}>
              <span className={styles.actItemTitle}>{status === "O" ? "Change overtime hours" : "Add overtime"}</span>
              <span lang="ne" className={styles.actItemSub}>
                ओभरटाइम थप्नुहोस्
              </span>
            </span>
            <span aria-hidden="true" className={styles.actChevron}>
              ›
            </span>
          </button>
          {canPay ? (
            <button type="button" className={styles.actItem} onClick={onPayments}>
              <span className={`${styles.actIcon} ${styles.actIconPay}`}>₨</span>
              <span className={styles.actItemText}>
                <span className={styles.actItemTitle}>View payments</span>
                <span className={styles.actItemSub}>Advances &amp; salary this month</span>
              </span>
              <span aria-hidden="true" className={styles.actChevron}>
                ›
              </span>
            </button>
          ) : null}
          <button type="button" className={styles.actItem} onClick={onCalendar}>
            <span className={`${styles.actIcon} ${styles.actIconCal}`}>▦</span>
            <span className={styles.actItemText}>
              <span className={styles.actItemTitle}>View attendance calendar</span>
              <span className={styles.actItemSub}>Day-by-day this month</span>
            </span>
            <span aria-hidden="true" className={styles.actChevron}>
              ›
            </span>
          </button>
        </div>
        <div className={styles.actChange}>
          <span className={styles.actChangeLabel}>Change status</span>
          {(["P", "A"] as const)
            .filter((k) => k !== status)
            .map((k) => (
              <button key={k} type="button" className={styles.actChangeBtn} data-status={k} onClick={() => onChange(k)}>
                {k === "P" ? "✓ Present" : "✕ Absent"}
              </button>
            ))}
          {status !== "N" ? (
            <button type="button" className={styles.actChangeBtn} data-status="N" onClick={onClear}>
              Clear mark
            </button>
          ) : null}
        </div>
        <button type="button" className={styles.secondaryBtn} onClick={onClose}>
          Close
        </button>
      </section>
    </div>
  );
}
