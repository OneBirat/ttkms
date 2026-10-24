"use client";

import { RANGE_PRESETS, compareIso, presetOf, rangeFor, type BsRange, type Lang, type RangePreset } from "@/lib/bs";
import { BSDate } from "./BSDate";
import type { PickerLimits } from "./pickerModel";
import { useDateLang } from "./useDateLang";
import styles from "./date.module.css";

export interface BSDateRangePickerProps extends PickerLimits {
  /** BS "YYYY-MM-DD" from / to, inclusive. */
  value: BsRange;
  onChange: (range: BsRange, preset: RangePreset | null) => void;
  lang?: Lang;
  /** Show the preset chips (This month / Last month / Last 30 days / Last 3 months). */
  presets?: boolean;
  labels?: { from?: string; to?: string };
  size?: "sm" | "md";
  now?: Date | string | number;
  /** Show a Clear chip when either end is set; `onChange({ from: "", to: "" }, null)` is sent. */
  clearable?: boolean;
  placeholder?: string;
}

/** From / To dates plus presets. Picking a From after To (or vice versa) moves the other end. */
export function BSDateRangePicker({ value, onChange, lang: langProp, presets = true, labels, size, now, clearable, placeholder, ...limits }: BSDateRangePickerProps) {
  const [savedLang] = useDateLang();
  const lang = langProp ?? savedLang;
  const active = presetOf(value, now);

  function update(next: BsRange) {
    onChange(next, presetOf(next, now));
  }

  return (
    <div className={styles.range}>
      <BSDate
        label={labels?.from ?? (lang === "ne" ? "देखि" : "From")}
        value={value.from}
        lang={lang}
        size={size}
        now={now}
        placeholder={placeholder}
        {...limits}
        onChange={(from) => update({ from, to: value.to && compareIso(from, value.to) > 0 ? from : value.to })}
      />
      <BSDate
        label={labels?.to ?? (lang === "ne" ? "सम्म" : "To")}
        value={value.to}
        lang={lang}
        size={size}
        now={now}
        placeholder={placeholder}
        {...limits}
        onChange={(to) => update({ from: value.from && compareIso(to, value.from) < 0 ? to : value.from, to })}
      />
      {presets ? (
        <div className={styles.presets} role="group" aria-label={lang === "ne" ? "अवधि" : "Range presets"}>
          {RANGE_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              className={styles.chip}
              lang={lang}
              aria-pressed={active === p.value}
              onClick={() => onChange(rangeFor(p.value, now), p.value)}
            >
              {lang === "ne" ? p.label_ne : p.label}
            </button>
          ))}
          {clearable && (value.from || value.to) ? (
            <button type="button" className={styles.chip} onClick={() => onChange({ from: "", to: "" }, null)}>
              {lang === "ne" ? "हटाउनुहोस्" : "Clear"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
