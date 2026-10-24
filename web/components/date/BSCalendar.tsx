"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  MONTHS_EN,
  MONTHS_NE,
  WEEKDAYS_SHORT_EN,
  WEEKDAYS_SHORT_NE,
  compareIso,
  digits,
  formatAd,
  formatBs,
  isoBs,
  parseBs,
  shiftMonth,
  toNepaliDigits,
  validBs,
  weekdayName,
  type Lang,
} from "@/lib/bs";
import {
  effectiveBounds,
  initialMonth,
  monthGrid,
  monthInBounds,
  moveDate,
  todayParts,
  weekEdge,
  yearOptions,
  type PickerLimits,
} from "./pickerModel";
import styles from "./date.module.css";

export interface BSCalendarProps extends PickerLimits {
  /** Selected BS date "YYYY-MM-DD" or null. */
  value: string | null;
  /** Called with the BS date when a day is picked (also on Enter / Space). */
  onSelect: (bs: string) => void;
  /** Escape or Done. */
  onClose?: () => void;
  lang?: Lang;
  /** Today override, for tests. */
  now?: Date | string | number;
  /** Focus the selected (or today's) cell when mounted. */
  autoFocus?: boolean;
  /** Show the type-a-date box and the Today / Done buttons (default true). */
  footer?: boolean;
  /** BS dates to flag with a dot (e.g. days with attendance marked) and the legend text for it. */
  markedDays?: Iterable<string>;
  markedLabel?: string;
}

/**
 * The BS month grid used by <BSDatePicker>: BS day with the AD day small in each cell, Saturday
 * red, today ringed, ‹ › months, month / year selects, Today, min / max and no-future-days limits,
 * keyboard navigation (arrows, PageUp/Down, Home/End, Enter) and an ARIA grid.
 */
export function BSCalendar({
  value,
  onSelect,
  onClose,
  lang = "en",
  min,
  max,
  noFutureDays,
  now,
  autoFocus = true,
  footer = true,
  markedDays,
  markedLabel,
}: BSCalendarProps) {
  const marked = useMemo(() => new Set(markedDays ?? []), [markedDays]);
  const today = useMemo(() => todayParts(now), [now]);
  const bounds = useMemo(() => effectiveBounds({ min, max, noFutureDays }, today.bs), [min, max, noFutureDays, today.bs]);
  const [view, setView] = useState(() => initialMonth(value, today.parts, bounds));
  const [focusBs, setFocusBs] = useState<string>(() => (value && validBs(value) ? value : today.bs));
  const [typed, setTyped] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);
  const id = useId();

  // Follow an external value change (e.g. the Today button of the parent).
  useEffect(() => {
    const v = value ? validBs(value) : null;
    if (v) {
      setView({ year: v.year, month: v.month });
      setFocusBs(isoBs(v));
    }
  }, [value]);

  const { lead, cells } = useMemo(() => monthGrid(view, bounds, today.bs), [view, bounds, today.bs]);
  const years = useMemo(() => yearOptions(bounds), [bounds]);
  const prev = shiftMonth(view.year, view.month, -1);
  const next = shiftMonth(view.year, view.month, 1);
  const months = lang === "ne" ? MONTHS_NE : MONTHS_EN;
  const weekdays = lang === "ne" ? WEEKDAYS_SHORT_NE : WEEKDAYS_SHORT_EN;

  // Roving tabindex: focus the active cell after keyboard moves.
  const focusPending = useRef(autoFocus);
  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-bs="${focusBs}"]`)?.focus();
  }, [focusBs, view]);

  function moveFocus(bs: string) {
    const p = validBs(bs);
    if (!p) return;
    focusPending.current = true;
    setFocusBs(bs);
    setView({ year: p.year, month: p.month });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keyMap: Record<string, () => string> = {
      ArrowLeft: () => moveDate(focusBs, "day", -1),
      ArrowRight: () => moveDate(focusBs, "day", 1),
      ArrowUp: () => moveDate(focusBs, "week", -1),
      ArrowDown: () => moveDate(focusBs, "week", 1),
      PageUp: () => moveDate(focusBs, event.shiftKey ? "year" : "month", -1),
      PageDown: () => moveDate(focusBs, event.shiftKey ? "year" : "month", 1),
      Home: () => weekEdge(focusBs, "start"),
      End: () => weekEdge(focusBs, "end"),
    };
    const move = keyMap[event.key];
    if (move) {
      event.preventDefault();
      moveFocus(move());
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (compareIso(focusBs, bounds.min) >= 0 && compareIso(focusBs, bounds.max) <= 0) onSelect(focusBs);
    } else if (event.key === "Escape" && onClose) {
      event.preventDefault();
      onClose();
    }
  }

  const selectedParts = value ? validBs(value) : null;
  const typedParts = typed ? validBs(typed) : null;
  const typedInvalid = typed !== "" && (!typedParts || compareIso(typed, bounds.min) < 0 || compareIso(typed, bounds.max) > 0);
  const todayPickable = compareIso(today.bs, bounds.min) >= 0 && compareIso(today.bs, bounds.max) <= 0;

  return (
    <div className={styles.calendar}>
      <div className={styles.nav}>
        <button
          type="button"
          className={styles.navBtn}
          aria-label={lang === "ne" ? "अघिल्लो महिना" : "Previous month"}
          disabled={!monthInBounds(prev, bounds)}
          onClick={() => setView(prev)}
        >
          ‹
        </button>
        <div className={styles.navSelects}>
          <select
            className={styles.select}
            lang={lang}
            aria-label={lang === "ne" ? "महिना" : "Month"}
            value={view.month}
            onChange={(e) => setView({ year: view.year, month: Number(e.target.value) })}
          >
            {months.map((name, i) => (
              <option key={name} value={i + 1} disabled={!monthInBounds({ year: view.year, month: i + 1 }, bounds)}>
                {name}
              </option>
            ))}
          </select>
          <select
            className={styles.select}
            lang={lang}
            aria-label={lang === "ne" ? "वर्ष" : "Year"}
            value={view.year}
            onChange={(e) => setView({ year: Number(e.target.value), month: view.month })}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {digits(y, lang)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className={styles.navBtn}
          aria-label={lang === "ne" ? "अर्को महिना" : "Next month"}
          disabled={!monthInBounds(next, bounds)}
          onClick={() => setView(next)}
        >
          ›
        </button>
      </div>
      <div className={styles.subtitle}>
        {lang === "ne" ? `${MONTHS_EN[view.month - 1]} ${view.year}` : `${MONTHS_NE[view.month - 1]} ${toNepaliDigits(view.year)}`}
        {" · "}
        {formatAd(cells[0].ad, "%b %Y")}
        {cells[0].ad.slice(0, 7) !== cells[cells.length - 1].ad.slice(0, 7) ? ` – ${formatAd(cells[cells.length - 1].ad, "%b %Y")}` : ""}
      </div>
      <div className={styles.weekdays} lang={lang} aria-hidden="true">
        {weekdays.map((w, i) => (
          <span key={w} className={i === 6 ? styles.sat : undefined}>
            {w}
          </span>
        ))}
      </div>
      <div
        ref={gridRef}
        role="grid"
        aria-label={`${MONTHS_EN[view.month - 1]} ${view.year}`}
        aria-activedescendant={`${id}-${focusBs}`}
        className={styles.grid}
        onKeyDown={onKeyDown}
      >
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} className={styles.lead} aria-hidden="true" />
        ))}
        {cells.map((d) => {
          const isSel = d.bs === value;
          const adParts = d.ad.split("-");
          const adLabel = adParts[2] === "01" || d.day === 1 ? formatAd(d.ad, "%-d %b") : String(Number(adParts[2]));
          return (
            <button
              key={d.bs}
              id={`${id}-${d.bs}`}
              type="button"
              role="gridcell"
              aria-selected={isSel}
              aria-label={`${formatBs(d.bs, "%A, %B %-d, %Y", lang)} · ${formatAd(d.ad)}${d.isToday ? (lang === "ne" ? " (आज)" : " (today)") : ""}`}
              tabIndex={d.bs === focusBs ? 0 : -1}
              disabled={d.disabled}
              className={styles.cell}
              data-bs={d.bs}
              data-sel={isSel || undefined}
              data-today={d.isToday || undefined}
              data-sat={d.isSaturday || undefined}
              data-marked={marked.has(d.bs) || undefined}
              onClick={() => onSelect(d.bs)}
              onFocus={() => setFocusBs(d.bs)}
            >
              <span className={styles.cellBs} lang={lang}>
                {digits(d.day, lang)}
              </span>
              <span className={styles.cellAd}>{adLabel}</span>
              {marked.has(d.bs) ? <span aria-hidden="true" className={styles.dot} /> : null}
            </button>
          );
        })}
      </div>
      {marked.size > 0 || noFutureDays ? (
        <div className={styles.legend}>
          {marked.size > 0 ? (
            <span>
              <span className={styles.legendDot} /> {markedLabel ?? (lang === "ne" ? "भरिएको" : "marked")}
            </span>
          ) : null}
          <span className={styles.sat}>{lang === "ne" ? "शनि = साप्ताहिक बिदा" : "Sat = weekly off"}</span>
          {noFutureDays ? <span>{lang === "ne" ? "आउँदा दिन बन्द" : "Future days locked"}</span> : null}
        </div>
      ) : null}
      {footer ? (
        <>
          <div className={styles.footer}>
            <div className={styles.selected} aria-live="polite">
              {selectedParts ? (
                <>
                  <span className={styles.selectedBs} lang={lang}>
                    {formatBs(value!, "%A, %B %-d, %Y", lang)}
                  </span>
                  <span className={styles.selectedAd}>
                    {weekdayName(parseBs(value!) ? cells.find((c) => c.bs === value)?.weekday ?? 0 : 0, "en").slice(0, 3)}{" "}
                    {formatAd(cells.find((c) => c.bs === value)?.ad ?? "", "%-d %b %Y")}
                  </span>
                </>
              ) : (
                <span className={styles.selectedAd}>{lang === "ne" ? "मिति छान्नुहोस्" : "Pick a date"}</span>
              )}
            </div>
            <div className={styles.footerBtns}>
              <button
                type="button"
                className={styles.smallBtn}
                disabled={!todayPickable}
                onClick={() => {
                  onSelect(today.bs);
                  moveFocus(today.bs);
                }}
              >
                <span lang="ne">आज</span> / Today
              </button>
              {onClose ? (
                <button type="button" className={`${styles.smallBtn} ${styles.smallBtnPrimary}`} onClick={onClose}>
                  {lang === "ne" ? "भयो" : "Done"}
                </button>
              ) : null}
            </div>
          </div>
          <form
            className={styles.typed}
            onSubmit={(e) => {
              e.preventDefault();
              if (typedParts && !typedInvalid) {
                onSelect(isoBs(typedParts));
                moveFocus(isoBs(typedParts));
                setTyped("");
              }
            }}
          >
            <label htmlFor={`${id}-typed`}>{lang === "ne" ? "BS मिति लेख्नुहोस्" : "Type BS date"}</label>
            <input
              id={`${id}-typed`}
              className={styles.typedInput}
              inputMode="numeric"
              placeholder="YYYY-MM-DD"
              value={typed}
              aria-invalid={typedInvalid || undefined}
              onChange={(e) => setTyped(e.target.value)}
            />
          </form>
        </>
      ) : null}
    </div>
  );
}
