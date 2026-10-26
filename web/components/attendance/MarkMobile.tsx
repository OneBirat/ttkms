"use client";

import { FaceContent } from "./Face";
import { useEffect } from "react";
import { formatAdShort, formatBs, toNepaliDigits, validBs } from "@/lib/bs";
import { useShell } from "@/lib/shell";
import { ChevronDownIcon, MenuIcon, ScanIcon, SearchIcon } from "./icons";
import { draftText, type Draft, type StatusFilter } from "./helpers";
import type { CellStatus, MarkRow } from "./types";
import type { MarkState } from "./useMarkState";
import styles from "./mobile.module.css";

const STATUS_CHIPS: { key: StatusFilter; label: string }[] = [
  { key: "", label: "All" },
  { key: "N", label: "Not marked" },
  { key: "P", label: "Present" },
  { key: "O", label: "Overtime" },
  { key: "A", label: "Absent" },
];

/**
 * Phone layout of Mark attendance (design/final/AttendanceMarkMobile.dc.html):
 * dark header with menu, day card (‹ › आज / N दिन अघि, BS + AD, tap = calendar),
 * Present card and Scan; search, department and status chips, cards with ⋮;
 * every mark saves at once (no save bar). Covers the whole viewport (its own
 * header replaces the shell's phone bar); the menu button opens the shell's
 * PhoneDrawer.
 */
export function MarkMobile({ state }: { state: MarkState }) {
  const { openMenu } = useShell();
  const { data, counts, listRows, limit, draftOf, statusOf } = state;
  const shown = listRows.slice(0, limit);
  const remaining = Math.max(0, listRows.length - limit);
  const branch = data?.branches.find((b) => b.id === state.branchId);
  const branchShort = branch ? branch.name.replace(/\s*branch$/i, "") || branch.name : "…";

  // The page scrolls inside its own panel; keep the shell behind it still.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const sel = validBs(state.date);
  const selNpShort = sel ? formatBs(sel, "%B %-d", "ne") : "";
  const selAd = data ? formatAdShort(data.day.ad_date, true) : "";
  const selEn = sel ? formatBs(sel) : state.date;
  const dayWord = state.isPast ? `${toNepaliDigits(state.daysAgo)} दिन अघि` : "आज";
  const countOf = (key: StatusFilter) =>
    key === ""
      ? counts.total
      : key === "N"
        ? counts.not_marked
        : key === "P"
          ? counts.present
          : key === "O"
            ? counts.overtime
            : counts.absent;

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.headerRow}>
          <button type="button" aria-label="Open menu" className={styles.iconBtn} onClick={openMenu}>
            <MenuIcon />
          </button>
          <div className={styles.titleBlock}>
            <span className={styles.title}>Mark attendance</span>
          </div>
          {state.canPickBranch ? (
            <label className={styles.branchChip}>
              {branchShort}
              <ChevronDownIcon className={styles.branchCaret} />
              <select aria-label="Branch" value={state.branchId} onChange={(e) => state.setBranch(Number(e.target.value))}>
                {(data?.branches ?? [{ id: state.branchId, name: "…", headcount: 0 }]).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className={styles.tiles}>
          <div className={styles.dayCard}>
            <div className={styles.dayNav}>
              <button type="button" aria-label="Previous day" className={styles.dayArrow} onClick={state.prevDay}>
                ‹
              </button>
              <span lang="ne" className={styles.dayWord} data-past={state.isPast || undefined}>
                {dayWord}
              </span>
              <button type="button" aria-label="Next day" className={styles.dayArrow} disabled={!state.isPast} onClick={state.nextDay}>
                ›
              </button>
            </div>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-label={`Change date, ${selEn}`}
              className={styles.dayPick}
              onClick={() => state.setCalendarOpen(true)}
            >
              <span lang="ne" className={styles.dayNp}>
                {selNpShort}
              </span>
              <span className={styles.dayAd}>{selAd}</span>
            </button>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileLabel}>Present</span>
            <span className={styles.tileValue}>
              {counts.present + counts.overtime}
              <span className={styles.tileOf}> / {counts.total}</span>
            </span>
          </div>
          <button type="button" aria-label="Scan staff card" className={styles.scanTile} onClick={state.openScanner}>
            <ScanIcon size={22} />
            <span className={styles.scanTileText}>
              <span className={styles.scanTileLabel}>Scan</span>
              <span lang="ne" className={styles.scanTileNp}>
                स्क्यान
              </span>
            </span>
          </button>
        </div>
      </header>

      <div className={styles.body}>
        {state.isPast ? (
          <div role="status" className={styles.pastBanner}>
            <span className={styles.pastText}>
              <b>Editing a past day</b> · {selEn}{" "}
              <span lang="ne">({selNpShort})</span>
            </span>
            <button type="button" className={styles.pastToday} onClick={state.goToday}>
              Today
            </button>
          </div>
        ) : null}
        <div className={styles.pad}>
          <div className={styles.search}>
            <SearchIcon size={18} />
            <input
              type="search"
              aria-label="Search staff"
              placeholder="Search name or ID"
              value={state.query}
              onChange={(e) => state.setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className={styles.chipsWrap}>
          <div className={styles.chips} role="group" aria-label="Department">
            <button
              type="button"
              className={styles.chip}
              aria-pressed={state.departmentId === null}
              onClick={() => state.setDepartment(null)}
            >
              All · {data?.rows.length ?? 0}
            </button>
            {(data?.departments ?? []).map((d) => (
              <button
                key={d.id}
                type="button"
                className={styles.chip}
                aria-pressed={state.departmentId === d.id}
                onClick={() => state.setDepartment(d.id)}
              >
                {d.name} · {d.headcount}
              </button>
            ))}
          </div>
          <div aria-hidden="true" className={styles.chipsFade}>
            ›
          </div>
        </div>
        <div className={styles.chips} role="group" aria-label="Status filter">
          {STATUS_CHIPS.filter((c) => c.key === "" || countOf(c.key) >= 1).map((c) => (
            <button
              key={c.key || "all"}
              type="button"
              className={styles.stChip}
              data-filter={c.key || "all"}
              aria-pressed={state.statusFilter === c.key}
              onClick={() => state.setStatusFilter(state.statusFilter === c.key && c.key ? "" : c.key)}
            >
              {c.label}
              <b>{countOf(c.key)}</b>
            </button>
          ))}
        </div>
        <div className={styles.scopeRow}>
          <span className={styles.scope}>{state.scopeLabel}</span>
        </div>

        {state.error ? (
          <p role="alert" className={`${styles.pad} ${styles.error}`}>
            {state.error}
          </p>
        ) : null}
        {state.loading ? (
          <p role="status" className={`${styles.pad} ${styles.muted}`}>
            Loading…
          </p>
        ) : null}

        {shown.map((row) => (
          <Card key={row.employee.id} row={row} draft={draftOf(row)} status={statusOf(row)} state={state} />
        ))}
        {!state.loading && !state.error && listRows.length === 0 ? (
          <p className={styles.emptyNote}>No staff match. Try another department or clear the search.</p>
        ) : null}
        {remaining > 0 ? (
          <div className={styles.pad}>
            <button type="button" className={styles.showMore} onClick={state.showMore}>
              Show more ({remaining} left)
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Card({ row, draft, status, state }: { row: MarkRow; draft: Draft; status: CellStatus; state: MarkState }) {
  const e = row.employee;
  const pending = state.pending.has(e.id);
  return (
    <article className={styles.card} data-status={status} aria-busy={pending || undefined}>
      <div className={styles.cardHead}>
        <span className={styles.avatar} data-status={status} aria-hidden="true">
          <FaceContent employee={e} />
        </span>
        <div className={styles.cardText}>
          <span className={styles.cardName}>{e.name}</span>
          <span className={styles.cardMeta}>
            {e.code} · {e.department_name}
          </span>
        </div>
        <span className={styles.badge} data-status={status}>
          {draftText(draft)}
        </span>
        <button
          type="button"
          aria-label={`More options for ${e.name}`}
          aria-haspopup="dialog"
          className={styles.moreBtn}
          onClick={() => state.openAction(e.id)}
        >
          ⋮
        </button>
      </div>
      {status === "N" ? (
        <div role="group" aria-label={`Status for ${e.name}`} className={styles.cardBtns}>
          <button type="button" className={styles.cardBtn} data-status="P" disabled={pending} onClick={() => state.askStatus(e.id, "P")}>
            ✓ Present
          </button>
          <button
            type="button"
            className={styles.cardBtn}
            data-status="O"
            aria-haspopup="dialog"
            disabled={pending}
            onClick={() => state.openOvertime(e.id)}
          >
            + Overtime
          </button>
          <button type="button" className={styles.cardBtn} data-status="A" disabled={pending} onClick={() => state.askStatus(e.id, "A")}>
            ✕ Absent
          </button>
        </div>
      ) : null}
    </article>
  );
}
