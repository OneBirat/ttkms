"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import styles from "./admin.module.css";

export interface ToastMessage {
  text: string;
  tone?: "ok" | "danger";
}

export function useToast(timeoutMs = 4500) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setToast(null);
  }, []);

  const show = useCallback(
    (text: string, tone: ToastMessage["tone"] = "ok") => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ text, tone });
      timer.current = setTimeout(() => setToast(null), timeoutMs);
    },
    [timeoutMs],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { toast, show, dismiss };
}

export function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastMessage | null;
  onDismiss: () => void;
}) {
  return (
    <div role="status" aria-live="polite">
      {toast ? (
        <div className={styles.toast} data-tone={toast.tone ?? "ok"}>
          <span>{toast.text}</span>
          <button
            type="button"
            className={styles.toastClose}
            aria-label="Dismiss message"
            onClick={onDismiss}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
