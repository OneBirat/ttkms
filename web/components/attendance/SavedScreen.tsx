"use client";

import { useId } from "react";
import { CheckIcon } from "./icons";
import type { MarkCounts } from "./helpers";
import type { TodayRef } from "./types";
import { useDialog } from "./useDialog";
import styles from "./mobile.module.css";

export interface SavedScreenProps {
  counts: MarkCounts;
  branch: string;
  today: TodayRef;
  onClose: () => void;
}

/** Full-screen "Attendance saved · हाजिरी सेभ भयो" with the day's counts. */
export function SavedScreen({ counts, branch, today, onClose }: SavedScreenProps) {
  const titleId = useId();
  const dialog = useDialog(onClose);
  const tiles: [string, number, string][] = [
    ["Overtime (h)", counts.overtime_hours, "#253f73"],
    ["Present", counts.present + counts.overtime, "#0a4f4f"],
    ["Absent", counts.absent, "#8e2f12"],
    ["Not marked", counts.not_marked, "#8a4205"],
  ];
  return (
    <section
      ref={dialog.ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className={styles.saved}
      onKeyDown={dialog.onKeyDown}
    >
      <div className={styles.savedHead}>
        <span className={styles.savedIcon}>
          <CheckIcon size={34} />
        </span>
        <h2 id={titleId} className={styles.savedTitle}>
          Attendance saved
        </h2>
        <span lang="ne" className={styles.savedNp}>
          हाजिरी सेभ भयो
        </span>
        <span className={styles.savedSub}>
          {branch} · {today.bs_text} ({today.ad_text})
        </span>
      </div>
      <div className={styles.savedTiles}>
        {tiles.map(([label, value, color]) => (
          <div key={label} className={styles.savedTile}>
            <span className={styles.savedTileLabel}>{label}</span>
            <span className={styles.savedTileValue} style={{ color }}>
              {value}
            </span>
          </div>
        ))}
      </div>
      <div className={styles.savedSpacer} />
      <div className={styles.savedActions}>
        <button type="button" className={styles.savedBack} onClick={onClose} data-autofocus="">
          Back to list
        </button>
      </div>
    </section>
  );
}
