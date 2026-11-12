"use client";

import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import styles from "./lock.module.css";

export interface OverrideDotProps {
  /** "Changed by Owner Shrestha on Kartik 26, 2083: P → A · Was on site" (from the API). */
  text: string;
  /** Extra class for where the dot sits in its cell (default: the cell's top-left corner). */
  className?: string;
  /**
   * False inside something that is itself a button (the calendar's day cell, which opens the
   * day's detail): then it is only the mark, the detail shows the text.
   */
  interactive?: boolean;
}

/**
 * The small dot on a report or calendar cell that the super admin changed after the day
 * locked. Hover or tap shows who changed it, when, old → new and the reason.
 */
export function OverrideDot({ text, className, interactive = true }: OverrideDotProps) {
  const [open, setOpen] = useState<"hover" | "pinned" | null>(null);
  const [at, setAt] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const tipId = useId();

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    const onDown = (event: globalThis.MouseEvent | TouchEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", close, true);
    };
  }, [open]);

  if (!interactive) {
    return <span aria-hidden="true" className={`${styles.dot} ${className ?? ""}`} data-override-dot="" />;
  }

  const place = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(280, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8));
    const above = rect.top > 140;
    setAt({ left, top: above ? rect.top - 8 : rect.bottom + 8, above });
  };
  const show = (how: "hover" | "pinned") => {
    place();
    setOpen(how);
  };
  const onClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (open === "pinned") setOpen(null);
    else show("pinned");
  };

  return (
    <button
      ref={ref}
      type="button"
      className={`${styles.dot} ${styles.dotBtn} ${className ?? ""}`}
      data-override-dot=""
      aria-label={text}
      aria-describedby={open ? tipId : undefined}
      aria-expanded={open !== null}
      onClick={onClick}
      onMouseEnter={() => open === null && show("hover")}
      onMouseLeave={() => open === "hover" && setOpen(null)}
      onFocus={() => open === null && show("hover")}
      onBlur={() => open === "hover" && setOpen(null)}
    >
      {open && at ? (
        <span
          id={tipId}
          role="tooltip"
          className={styles.dotTip}
          data-above={at.above || undefined}
          style={{ left: at.left, top: at.top }}
        >
          {text}
        </span>
      ) : null}
    </button>
  );
}
