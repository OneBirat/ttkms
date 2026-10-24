"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import styles from "../components/admin.module.css";
import modalStyles from "@/components/ui/Modal.module.css";

export interface TempPasswordDialogProps {
  /** "User created" or "Password reset". */
  title: string;
  /** Whose password it is. */
  who: string;
  password: string;
  onClose: () => void;
}

/**
 * Temporary password shown once (design/final/AdminUsers.dc.html "pin"
 * dialog): an alertdialog that only closes with Done, so it cannot be
 * dismissed by accident before the password has been passed on.
 */
export function TempPasswordDialog({ title, who, password, onClose }: TempPasswordDialogProps) {
  const titleId = useId();
  const doneRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    doneRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
      opener?.focus();
    };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 2500);
  };

  return (
    <div className={modalStyles.backdrop} style={{ zIndex: 41, alignItems: "center" }}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`card ${modalStyles.dialog} ${modalStyles.sm}`}
        style={{ padding: 24 }}
      >
        <div className={styles.pin}>
          <span className={styles.pinIcon} aria-hidden="true">
            <Icon name="lock" size={26} />
          </span>
          <h2 id={titleId} style={{ fontSize: 18, fontWeight: 700 }}>
            {title}
          </h2>
          <p className={styles.pinText}>
            Temporary password for <strong>{who}</strong>. Share it with them now — it won&apos;t
            be shown again. They set their own password at first sign-in.
          </p>
          <code className={styles.pinCode} aria-label="Temporary password">
            {password}
          </code>
          <div className={styles.pinActions}>
            <button type="button" className="btn" onClick={() => void copy()}>
              {copied === "done" ? <Icon name="check" size={18} /> : null}
              {copied === "done" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy"}
            </button>
            <button ref={doneRef} type="button" className="btn btn--primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
