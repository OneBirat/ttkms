"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { BsPickerPanel } from "./BsPickerPanel";
import type { EntryType } from "./types";
import styles from "./bsPicker.module.css";

export interface BsDatePickerProps {
  id: string;
  /** BS "YYYY-MM-DD" as typed; may be invalid while editing. */
  value: string;
  onChange: (bs: string) => void;
  /** "HH:MM" (24 h). */
  time: string;
  onTimeChange: (time: string) => void;
  /** Today's BS date ("YYYY-MM-DD") for the Today button and the ring. */
  todayBs: string;
  invalid?: boolean;
  describedBy?: string;
  /** Popover under the field (desktop) or bottom sheet (phone). */
  variant: "popover" | "sheet";
  /** Teal for purchase, amber for consumption. */
  tone: EntryType;
  /** Narrow mono input (phone date card). */
  compact?: boolean;
}

/**
 * Nepali date & time field: a typed BS input plus a calendar button that opens
 * the picker (BS month grid with Nepali digits, Saturday marked, AD day under
 * each cell, and a time row). The picker only writes valid dates back.
 */
export function BsDatePicker(props: BsDatePickerProps) {
  const { id, value, onChange, time, onTimeChange, todayBs, invalid, describedBy, variant, tone, compact } = props;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || variant !== "popover") return;
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, variant]);

  return (
    <div ref={wrapRef} className={styles.wrap}>
      <div className={`${styles.field} ${compact ? styles.fieldCompact : ""} ${invalid ? styles.fieldBad : ""}`}>
        <button
          type="button"
          aria-label="Open Nepali date picker"
          aria-haspopup="dialog"
          aria-expanded={open}
          className={styles.openButton}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name="calendar" size={16} />
        </button>
        <input
          id={id}
          inputMode="numeric"
          placeholder="YYYY-MM-DD"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={styles.input}
          autoComplete="off"
        />
        <span className={styles.timeChip} title="Time">
          <Icon name="clock" size={13} />
          {time}
        </span>
      </div>
      {open ? (
        <BsPickerPanel
          value={value}
          time={time}
          todayBs={todayBs}
          tone={tone}
          variant={variant}
          onPick={(bs) => {
            onChange(bs);
            if (variant === "popover") setOpen(false);
          }}
          onTime={onTimeChange}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
