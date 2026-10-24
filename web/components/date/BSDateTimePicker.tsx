"use client";

import { useId } from "react";
import {
  adToBsIso,
  bsToAd,
  digits,
  formatAd,
  formatBs,
  instantOf,
  kathmanduDate,
  kathmanduTime,
  todayAd,
  type Lang,
} from "@/lib/bs";
import { BSDate, type BSDateTextProps } from "./BSDate";
import type { PickerLimits } from "./pickerModel";
import { useDateLang } from "./useDateLang";
import styles from "./date.module.css";

/** "9:14 AM" in Nepal time; Nepali digits with lang "ne" ("९:१४ AM"). */
export function formatTime12(timestamp: string | Date, lang: Lang = "en"): string {
  const { hour, minute } = kathmanduTime(timestamp);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${digits(h12, lang)}:${digits(String(minute).padStart(2, "0"), lang)} ${hour < 12 ? "AM" : "PM"}`;
}

export interface BSDateTimeTextProps extends Omit<BSDateTextProps, "value"> {
  /** ISO timestamp (UTC) or null. */
  value: string | null | undefined;
}

/** A timestamp as "Kartik 7, 2083 · 9:14 AM" with the AD date and time as the AD line. */
export function BSDateTimeText({ value, lang: langProp, placeholder, inline, className }: BSDateTimeTextProps) {
  const [savedLang] = useDateLang();
  const lang = langProp ?? savedLang;
  if (!value) {
    return <span className={styles.date}><span className={styles.placeholder}>{placeholder ?? (lang === "ne" ? "कहिल्यै होइन" : "Never")}</span></span>;
  }
  const ad = kathmanduDate(value);
  const time = formatTime12(value, lang);
  return (
    <span className={`${styles.date}${inline ? ` ${styles.dateInline}` : ""}${className ? ` ${className}` : ""}`} title={`${formatAd(ad, "%a %-d %b %Y")}, ${formatTime12(value)} NPT`}>
      <span className={styles.bs} lang={lang}>
        {formatBs(adToBsIso(ad), "%B %-d, %Y", lang)} · {time}
      </span>
      {inline ? <span aria-hidden="true">·</span> : null}
      <span className={styles.ad}>{formatAd(ad)}</span>
    </span>
  );
}

export interface BSDateTimePickerProps extends PickerLimits {
  /** ISO timestamp in UTC, or null. */
  value: string | null;
  onChange: (iso: string) => void;
  lang?: Lang;
  label?: string;
  disabled?: boolean;
  now?: Date | string | number;
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

/** A date (BS picker) plus a 12-hour Nepal time; the value is a UTC instant. */
export function BSDateTimePicker({ value, onChange, lang: langProp, label, disabled, now, ...limits }: BSDateTimePickerProps) {
  const [savedLang] = useDateLang();
  const lang = langProp ?? savedLang;
  const id = useId();
  const ad = value ? kathmanduDate(value) : todayAd(now);
  const { hour, minute } = value ? kathmanduTime(value) : kathmanduTime(now ?? new Date());
  const pm = hour >= 12;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;

  function emit(nextAd: string, nextH12: number, nextMinute: number, nextPm: boolean) {
    const h24 = (nextH12 % 12) + (nextPm ? 12 : 0);
    onChange(instantOf(nextAd, h24, nextMinute));
  }

  return (
    <div className={styles.dateTime}>
      <BSDate
        label={label ?? (lang === "ne" ? "मिति" : "Date")}
        value={adToBsIso(ad)}
        lang={lang}
        disabled={disabled}
        now={now}
        {...limits}
        onChange={(bs) => emit(bsToAd(bs), h12, minute, pm)}
      />
      <div className={styles.time} role="group" aria-label={lang === "ne" ? "समय (नेपाल)" : "Time (Nepal)"}>
        <select id={`${id}-h`} aria-label={lang === "ne" ? "घण्टा" : "Hour"} className={styles.timeSelect} value={h12} disabled={disabled} onChange={(e) => emit(ad, Number(e.target.value), minute, pm)}>
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {digits(h, lang)}
            </option>
          ))}
        </select>
        <span aria-hidden="true">:</span>
        <select id={`${id}-m`} aria-label={lang === "ne" ? "मिनेट" : "Minute"} className={styles.timeSelect} value={minute} disabled={disabled} onChange={(e) => emit(ad, h12, Number(e.target.value), pm)}>
          {MINUTES.map((m) => (
            <option key={m} value={m}>
              {digits(String(m).padStart(2, "0"), lang)}
            </option>
          ))}
        </select>
        <span className={styles.ampm}>
          <button type="button" className={styles.ampmBtn} aria-pressed={!pm} disabled={disabled} onClick={() => emit(ad, h12, minute, false)}>
            AM
          </button>
          <button type="button" className={styles.ampmBtn} aria-pressed={pm} disabled={disabled} onClick={() => emit(ad, h12, minute, true)}>
            PM
          </button>
        </span>
        <span className={styles.timeHint}>NPT</span>
      </div>
    </div>
  );
}
