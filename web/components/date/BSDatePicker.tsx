"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useIsPhone } from "@/lib/useMediaQuery";
import type { Lang } from "@/lib/bs";
import { BSCalendar } from "./BSCalendar";
import type { PickerLimits } from "./pickerModel";
import styles from "./date.module.css";

export interface BSDatePickerProps extends PickerLimits {
  open: boolean;
  onClose: () => void;
  value: string | null;
  /** The picked BS date; the picker stays open until Done on phones and closes at once on desktop. */
  onChange: (bs: string) => void;
  lang?: Lang;
  /** Open the popover's right edge on the trigger's right edge. */
  align?: "left" | "right";
  /** Accessible name of the dialog. */
  title?: string;
  now?: Date | string | number;
  /** Extra content under the calendar (e.g. the time row of <BSDateTimePicker>). */
  children?: ReactNode;
  /** BS dates to flag with a dot, and the legend text for it. */
  markedDays?: Iterable<string>;
  markedLabel?: string;
}

/**
 * The calendar in a popover (desktop) or a bottom sheet (under 640px). Render it inside a
 * `position: relative` wrapper next to its trigger; <BSDate> does that for you.
 * Escape, the backdrop and clicks outside close it; focus returns to the opener.
 */
export function BSDatePicker({ open, onClose, value, onChange, lang = "en", align = "left", title, now, children, markedDays, markedLabel, ...limits }: BSDatePickerProps) {
  const phone = useIsPhone();
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node) && !opener?.contains(event.target as Node)) {
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  const label = title ?? (lang === "ne" ? "मिति छान्नुहोस्" : "Choose date");
  const calendar = (
    <BSCalendar
      value={value}
      lang={lang}
      now={now}
      markedDays={markedDays}
      markedLabel={markedLabel}
      onClose={onClose}
      onSelect={(bs) => {
        onChange(bs);
        if (!phone && !children) onClose();
      }}
      {...limits}
    />
  );

  if (phone) {
    return (
      <div className={styles.backdrop} onClick={onClose}>
        <section
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          className={styles.sheet}
          onClick={(e) => e.stopPropagation()}
        >
          <div aria-hidden="true" className={styles.sheetHandle} />
          {calendar}
          {children}
        </section>
      </div>
    );
  }
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className={`${styles.popover}${align === "right" ? ` ${styles.popoverRight}` : ""}`}
    >
      {calendar}
      {children}
    </div>
  );
}
