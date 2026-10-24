"use client";

import { useId, useState } from "react";
import { Icon } from "@/components/icons";
import { bsToAd, formatAd, formatBs, validBs, type Lang } from "@/lib/bs";
import { BSDatePicker } from "./BSDatePicker";
import type { PickerLimits } from "./pickerModel";
import { useDateLang } from "./useDateLang";
import styles from "./date.module.css";

export interface BSDateTextProps {
  /** BS "YYYY-MM-DD" (null renders the placeholder). */
  value: string | null | undefined;
  lang?: Lang;
  /** BS format (lib/bs formatBs tokens); default "Kartik 7, 2083". */
  format?: string;
  /** AD format; default "24 Oct 2026". Pass null to hide the AD part. */
  adFormat?: string | null;
  /** Show the weekday before the BS date. */
  weekday?: boolean;
  /** BS and AD on one line ("Kartik 7, 2083 · 24 Oct 2026") instead of stacked. */
  inline?: boolean;
  placeholder?: string;
  className?: string;
}

/** Read-only text: BS first, AD small. Follows the saved English / Nepali preference. */
export function BSDateText({ value, lang: langProp, format, adFormat = "%-d %b %Y", weekday, inline, placeholder, className }: BSDateTextProps) {
  const [savedLang] = useDateLang();
  const lang = langProp ?? savedLang;
  const parts = value ? validBs(value) : null;
  const cls = `${styles.date}${inline ? ` ${styles.dateInline}` : ""}${className ? ` ${className}` : ""}`;
  if (!parts) {
    return (
      <span className={cls}>
        <span className={styles.placeholder}>{value && !parts ? value : placeholder ?? (lang === "ne" ? "मिति छैन" : "No date")}</span>
      </span>
    );
  }
  const bsFmt = format ?? (weekday ? "%A, %B %-d, %Y" : "%B %-d, %Y");
  return (
    <span className={cls}>
      <span className={styles.bs} lang={lang}>
        {formatBs(value!, bsFmt, lang)}
      </span>
      {adFormat !== null ? (
        <>
          {inline ? <span aria-hidden="true">·</span> : null}
          <span className={styles.ad}>{formatAd(bsToAd(parts), adFormat)}</span>
        </>
      ) : null}
    </span>
  );
}

export interface BSDateProps extends BSDateTextProps, PickerLimits {
  /** When given, the date is editable: clicking opens the picker. */
  onChange?: (bs: string, ad: string) => void;
  label?: string;
  /** Hidden input name for plain form posts (BS "YYYY-MM-DD"). */
  name?: string;
  id?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  align?: "left" | "right";
  /** Display block (full-width field) instead of inline. */
  block?: boolean;
  now?: Date | string | number;
  /** BS dates to flag with a dot in the picker, and the legend text for it. */
  markedDays?: Iterable<string>;
  markedLabel?: string;
}

/**
 * A date, BS first and AD small ("Kartik 7, 2083 · 24 Oct 2026"). With `onChange` it is a
 * button that opens <BSDatePicker>; without it, plain text.
 */
export function BSDate({ onChange, label, name, id, size = "md", disabled, required, invalid, align, block, now, min, max, noFutureDays, markedDays, markedLabel, ...text }: BSDateProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [open, setOpen] = useState(false);
  const [savedLang] = useDateLang();
  const lang = text.lang ?? savedLang;

  if (!onChange) return <BSDateText {...text} />;

  return (
    <div className={`${styles.field}${block ? ` ${styles.fieldBlock}` : ""}`}>
      {label ? (
        <label htmlFor={inputId} className={styles.label}>
          {label}
        </label>
      ) : null}
      <button
        type="button"
        id={inputId}
        className={`${styles.trigger}${size === "sm" ? ` ${styles.triggerSm}` : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-invalid={invalid || undefined}
        data-required={required || undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <BSDateText {...text} lang={lang} />
        <span className={styles.triggerIcon} aria-hidden="true">
          <Icon name="calendar" size={16} />
        </span>
      </button>
      {name ? <input type="hidden" name={name} value={text.value ?? ""} /> : null}
      <BSDatePicker
        open={open}
        onClose={() => setOpen(false)}
        value={text.value ?? null}
        lang={lang}
        align={align}
        now={now}
        min={min}
        max={max}
        noFutureDays={noFutureDays}
        markedDays={markedDays}
        markedLabel={markedLabel}
        onChange={(bs) => onChange(bs, bsToAd(bs))}
      />
    </div>
  );
}
