"use client";

import { useId, useState } from "react";
import { Icon } from "@/components/icons";
import { formatBs, WEEKDAY_INITIALS_NP, WEEKDAYS_NP } from "@/lib/bsdate";
import { useDialog } from "./EntryDialogs";
import { initialMonth, isValidTime, monthGrid, nowTimeKathmandu, shiftMonth, type PickerMonth } from "./pickerLogic";
import type { EntryType } from "./types";
import styles from "./bsPicker.module.css";

export interface BsPickerPanelProps {
  value: string;
  time: string;
  todayBs: string;
  tone: EntryType;
  variant: "popover" | "sheet";
  onPick: (bs: string) => void;
  onTime: (time: string) => void;
  onClose: () => void;
}

/** The open calendar: month navigation, BS day grid, time row, Today / Done. */
export function BsPickerPanel({ value, time, todayBs, tone, variant, onPick, onTime, onClose }: BsPickerPanelProps) {
  const titleId = useId();
  const ref = useDialog(true, onClose);
  const [view, setView] = useState(() => initialMonth(value, todayBs));
  const grid: PickerMonth = monthGrid(view.year, view.month);
  const toneClass = tone === "purchase" ? styles.teal : styles.amber;
  const sheet = variant === "sheet";
  const body = (
    <div
      ref={ref}
      role="dialog"
      aria-modal={sheet ? "true" : undefined}
      aria-labelledby={titleId}
      className={`${styles.picker} ${sheet ? styles.pickerSheet : styles.pickerPopover} ${toneClass}`}
      tabIndex={-1}
      onClick={(e) => e.stopPropagation()}
    >
      {sheet ? (
        <div className={styles.grabber}>
          <span />
        </div>
      ) : null}
      <div className={styles.head}>
        <button
          type="button"
          aria-label="Previous month"
          className={styles.nav}
          disabled={!grid.canGoPrev}
          onClick={() => setView(shiftMonth(view.year, view.month, -1))}
        >
          <Icon name="chevron-left" size={18} />
        </button>
        <div className={styles.title}>
          <span id={titleId} lang="ne" className={styles.titleNp}>
            {grid.titleNp}
          </span>
          <span className={styles.titleEn}>{grid.titleEn}</span>
        </div>
        <button
          type="button"
          aria-label="Next month"
          className={styles.nav}
          disabled={!grid.canGoNext}
          onClick={() => setView(shiftMonth(view.year, view.month, 1))}
        >
          <Icon name="chevron-right" size={18} />
        </button>
        {sheet ? (
          <button type="button" aria-label="Close" className={styles.close} onClick={onClose}>
            ×
          </button>
        ) : null}
      </div>
      <table className={styles.grid} role="grid" aria-labelledby={titleId}>
        <thead>
          <tr>
            {WEEKDAY_INITIALS_NP.map((w, i) => (
              <th key={w} scope="col" abbr={WEEKDAYS_NP[i]} lang="ne" className={i === 6 ? styles.sat : ""}>
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.weeks.map((week, wi) => (
            <tr key={wi}>
              {week.map((cell, ci) =>
                cell ? (
                  <td key={cell.bs}>
                    <button
                      type="button"
                      className={`${styles.day} ${cell.saturday ? styles.sat : ""} ${cell.bs === value ? styles.selected : ""} ${cell.bs === todayBs ? styles.today : ""}`}
                      aria-label={`${formatBs(cell.bs, { lang: "en", weekday: true })} (${cell.ad})`}
                      aria-pressed={cell.bs === value}
                      onClick={() => onPick(cell.bs)}
                    >
                      <span lang="ne" className={styles.dayNp}>
                        {cell.dayNp}
                      </span>
                      <span className={styles.dayAd}>{cell.adDay}</span>
                    </button>
                  </td>
                ) : (
                  <td key={`e${ci}`} />
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.timeRow}>
        <label className={styles.timeLabel}>
          <Icon name="clock" size={16} />
          <span>
            Time <span lang="ne">· समय</span>
          </span>
          <input
            type="time"
            step={60}
            value={time}
            aria-invalid={!isValidTime(time) || undefined}
            onChange={(e) => onTime(e.target.value)}
            className={styles.timeInput}
          />
        </label>
        <button type="button" className={styles.nowButton} onClick={() => onTime(nowTimeKathmandu())}>
          Now
        </button>
      </div>
      <div className={styles.foot}>
        <button
          type="button"
          className={styles.todayButton}
          onClick={() => {
            setView(initialMonth(todayBs, todayBs));
            onPick(todayBs);
          }}
        >
          Today <span lang="ne">· आज</span>
        </button>
        {sheet ? (
          <button type="button" className={styles.doneButton} onClick={onClose}>
            Done
          </button>
        ) : (
          <span className={styles.footHint}>Pick a day to close · Esc</span>
        )}
      </div>
    </div>
  );
  if (sheet) {
    return (
      <div className={styles.sheetBackdrop} onClick={onClose}>
        {body}
      </div>
    );
  }
  return body;
}
