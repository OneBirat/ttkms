"use client";

import { useState, type ReactNode } from "react";
import { Modal } from "@/components/ui/Modal";
import { errorMessage } from "@/lib/api";
import styles from "./admin.module.css";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Body copy; put the consequence first ("3 employees are affected"). */
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Destructive actions use the danger button. */
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };

  return (
    <Modal open={open} title={title} onClose={close} size="sm">
      <div className={styles.form}>
        <div>{children}</div>
        {error ? (
          <p className={`${styles.note} ${styles.noteDanger}`} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.dialogActions}>
          <button type="button" className="btn" onClick={close} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? `btn ${styles.btnDanger}` : "btn btn--primary"}
            onClick={() => void confirm()}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
