"use client";

import { useId } from "react";
import { toDevanagariDigits } from "./bsdate";
import { CheckIcon } from "./icons";
import { initials, statusLabel } from "./helpers";
import { photoTint } from "./MarkRow";
import { useSecondsLeft } from "./scan/useCountdown";
import type { EmployeeRef } from "./types";
import { useDialog } from "./useDialog";
import { MANUAL_DONE_MS, type ManualDone } from "./useMarkState";
import styles from "./mobile.module.css";

export interface ManualDoneSheetProps {
  done: ManualDone;
  employee: EmployeeRef;
  onClose: () => void;
}

/** Phone: the saved sheet after a hand mark (AttendanceManualDone): closes itself after 3 s. */
export function ManualDoneSheet({ done, employee, onClose }: ManualDoneSheetProps) {
  const titleId = useId();
  const dialog = useDialog(onClose);
  const left = useSecondsLeft(done.token, MANUAL_DONE_MS);
  const changed = done.previous !== "N" && done.previous !== done.status;
  const text =
    done.status === "O" ? `Present + ${done.hours} h overtime` : done.status === "A" ? "Marked absent" : "Marked present";
  const np =
    done.status === "O"
      ? `हाजिर + ओभरटाइम ${toDevanagariDigits(done.hours)} घण्टा`
      : done.status === "A"
        ? "अनुपस्थित"
        : "हाजिर भयो";
  return (
    <div className={styles.doneBackdrop}>
      <section
        ref={dialog.ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.doneSheet}
        onKeyDown={dialog.onKeyDown}
      >
        <div className={styles.doneBody}>
          <span className={styles.donePhotoWrap}>
            <span role="img" aria-label={`Photo of ${employee.name}`} className={styles.donePhoto} style={{ background: photoTint(employee.id) }}>
              {initials(employee.name)}
            </span>
            <span aria-hidden="true" className={styles.doneBadge} data-status={done.status}>
              <CheckIcon size={18} />
            </span>
          </span>
          <h2 id={titleId} className={styles.doneName}>
            {employee.name}
          </h2>
          <span className={styles.doneText}>{text}</span>
          <span lang="ne" className={styles.doneNp}>
            {np}
          </span>
          {changed ? <span className={styles.donePrev}>Changed from {statusLabel(done.previous)}</span> : null}
          <span className={styles.doneHand}>Marked by hand · saved</span>
        </div>
        <div className={styles.countdown}>
          <div className={styles.progressThin} aria-hidden="true">
            <div className={styles.progressGreen} />
          </div>
          <span className={styles.countdownText} aria-live="polite">
            Closes in {left}s
          </span>
        </div>
        <button type="button" className={styles.doneOk} onClick={onClose} data-autofocus="">
          OK
        </button>
      </section>
    </div>
  );
}
