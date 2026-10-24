"use client";

import { useState } from "react";
import {
  BS_MONTHS_EN,
  BS_MONTHS_NP,
  WEEKDAY_NAMES_NP,
  bsMonthDays,
  diffDays,
  formatAdShort,
  parseBs,
  shiftMonth,
  toDevanagariDigits,
} from "./bsdate";
import { useDialog } from "./useDialog";
import type { TodayRef } from "./types";
import styles from "./mobile.module.css";

export interface CalendarSheetProps {
  /** Selected BS date "YYYY-MM-DD". */
  value: string;
  today: TodayRef;
  onPick: (bs: string) => void;
  onToday: () => void;
  onClose: () => void;
}

const WEEKDAYS_NP = ["आइत", "सोम", "मंगल", "बुध", "बिही", "शुक्र", "शनि"];

/** Phone date picker (design/final/AttendanceMarkMobile.dc.html, calendar sheet): BS month grid, future days locked. */
export function CalendarSheet({ value, today, onPick, onToday, onClose }: CalendarSheetProps) {
  const dialog = useDialog(onClose, { autoFocus: false });
  const selected = parseBs(value) ?? parseBs(today.bs_date)!;
  const todayParts = parseBs(today.bs_date)!;
  const [view, setView] = useState({ year: selected.year, month: selected.month });
  const days = bsMonthDays(view.year, view.month, 6);
  const nextOff = view.year > todayParts.year || (view.year === todayParts.year && view.month >= todayParts.month);
  const lead = days[0]?.weekday ?? 0;
  const selNp = `${WEEKDAY_NAMES_NP[days.find((d) => d.bs_date === value)?.weekday ?? 0]}, ${BS_MONTHS_NP[selected.month - 1]} ${toDevanagariDigits(selected.day)}`;
  const selAd = (() => {
    const d = days.find((x) => x.bs_date === value);
    return d ? formatAdShort(d.ad_date, true) : "";
  })();

  return (
    <div className={styles.calBackdrop} onClick={onClose}>
      <section
        ref={dialog.ref}
        role="dialog"
        aria-modal="true"
        aria-label="Choose date"
        tabIndex={-1}
        className={styles.calSheet}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={dialog.onKeyDown}
      >
        <div aria-hidden="true" className={styles.sheetHandle} />
        <div className={styles.calNav}>
          <button
            type="button"
            aria-label="Previous month"
            className={styles.calNavBtn}
            onClick={() => setView(shiftMonth(view.year, view.month, -1))}
          >
            ‹
          </button>
          <div className={styles.calTitle}>
            <span lang="ne" className={styles.calNp}>
              {BS_MONTHS_NP[view.month - 1]} {toDevanagariDigits(view.year)}
            </span>
            <span className={styles.calEn}>
              {BS_MONTHS_EN[view.month - 1]} {view.year}
            </span>
          </div>
          <button
            type="button"
            aria-label="Next month"
            className={styles.calNavBtn}
            disabled={nextOff}
            onClick={() => setView(shiftMonth(view.year, view.month, 1))}
          >
            ›
          </button>
        </div>
        <div className={styles.calWeekdays} lang="ne">
          {WEEKDAYS_NP.map((w, i) => (
            <span key={w} className={i === 6 ? styles.calSat : undefined}>
              {w}
            </span>
          ))}
        </div>
        <div role="grid" aria-label={`${BS_MONTHS_EN[view.month - 1]} ${view.year}`} className={styles.calGrid}>
          {Array.from({ length: lead }, (_, i) => (
            <span key={`lead-${i}`} aria-hidden="true" />
          ))}
          {days.map((d) => {
            const future = diffDays(today.ad_date, d.ad_date) > 0;
            const isToday = d.bs_date === today.bs_date;
            const isSel = d.bs_date === value;
            const sat = d.weekday === 6;
            const marked = !future && !sat;
            return (
              <button
                key={d.bs_date}
                type="button"
                role="gridcell"
                aria-selected={isSel}
                aria-label={`${BS_MONTHS_EN[view.month - 1]} ${d.bs_day}, ${view.year}${isToday ? " (today)" : ""}${sat ? ", Saturday off" : ""}`}
                disabled={future}
                className={styles.calCell}
                data-sel={isSel || undefined}
                data-today={isToday || undefined}
                data-sat={sat || undefined}
                onClick={() => onPick(d.bs_date)}
              >
                <span lang="ne" className={styles.calCellNp}>
                  {toDevanagariDigits(d.bs_day)}
                </span>
                <span className={styles.calCellEn}>{d.bs_day}</span>
                {marked ? <span aria-hidden="true" className={styles.calDot} /> : null}
              </button>
            );
          })}
        </div>
        <div className={styles.calLegend}>
          <span>
            <span className={styles.calLegendDot} /> attendance marked
          </span>
          <span className={styles.calSat}>शनि = weekly off</span>
          <span>Future days locked</span>
        </div>
        <div className={styles.calSelected}>
          <span>
            <span lang="ne" className={styles.calSelectedNp}>
              {selNp}
            </span>{" "}
            · {BS_MONTHS_EN[selected.month - 1]} {selected.day}, {selected.year}
          </span>
          <span className={styles.calSelectedAd}>{selAd}</span>
        </div>
        <div className={styles.twoBtns}>
          <button type="button" className={styles.secondaryBtn} onClick={onToday}>
            Today · <span lang="ne">आज</span>
          </button>
          <button type="button" className={styles.primaryBtn} onClick={onClose}>
            Done
          </button>
        </div>
      </section>
    </div>
  );
}
