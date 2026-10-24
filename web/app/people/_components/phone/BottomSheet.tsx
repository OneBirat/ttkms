"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./phone.module.css";

export interface BottomSheetProps {
  open: boolean;
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/** Bottom sheet with a handle; tap outside or Escape closes. */
export function BottomSheet({ open, label, onClose, children }: BottomSheetProps) {
  const ref = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      opener?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className={styles.sheetWrap}>
      <div className={styles.sheetBackdrop} aria-hidden="true" onClick={onClose} />
      <section ref={ref} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={styles.sheet}>
        <span aria-hidden="true" className={styles.sheetHandle} />
        {children}
      </section>
    </div>
  );
}
