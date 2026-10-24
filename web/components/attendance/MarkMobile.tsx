"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { ChevronDownIcon, MenuIcon, ScanIcon, SearchIcon } from "./icons";
import { MobileDrawer } from "./MobileDrawer";
import { SavedScreen } from "./SavedScreen";
import { STATUS_META, draftText, initials, type Draft } from "./helpers";
import type { MarkRow } from "./types";
import type { MarkState } from "./useMarkState";
import styles from "./mobile.module.css";

/**
 * Phone layout of Mark attendance (design/attendance/AttendanceMarkMobile.dc.html):
 * dark header with menu, date, branch chip and scan button; three count tiles;
 * search, big scan button, department chips, cards; sticky save bar.
 * It covers the whole viewport (the shared shell has no phone header yet).
 */
export function MarkMobile({ state }: { state: MarkState }) {
  const { user, modules, logout } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const { data, counts, listRows, limit, draftOf } = state;
  const shown = listRows.slice(0, limit);
  const remaining = Math.max(0, listRows.length - limit);
  const branch = data?.branches.find((b) => b.id === state.branchId);
  const branchShort = branch ? branch.name.replace(/\s*branch$/i, "") || branch.name : "…";
  const marked = counts.total - counts.not_marked;

  // The page scrolls inside its own panel; keep the shell behind it still.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const openTileClass = state.onlyOpen
    ? styles.tileOpenOn
    : counts.not_marked
      ? styles.tileOpenSome
      : styles.tileOpenNone;

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.headerRow}>
          <button
            type="button"
            aria-label="Open menu"
            className={styles.iconBtn}
            onClick={() => setMenuOpen(true)}
          >
            <MenuIcon />
          </button>
          <div className={styles.titleBlock}>
            <span className={styles.title}>Mark attendance</span>
            <span className={styles.dateLine}>
              <span lang="ne">{state.today?.np_text ?? ""}</span>
              {state.today ? ` · ${state.today.bs_text}` : ""}
            </span>
          </div>
          <button
            type="button"
            aria-label="Scan staff card"
            className={`${styles.iconBtn} ${styles.scanBtn}`}
            onClick={state.openScanner}
          >
            <ScanIcon size={22} />
          </button>
          <label className={styles.branchChip}>
            {branchShort}
            <ChevronDownIcon className={styles.branchCaret} />
            <select
              aria-label="Branch"
              value={state.branchId}
              onChange={(e) => state.setBranch(Number(e.target.value))}
            >
              {(data?.branches ?? [{ id: state.branchId, name: "…", headcount: 0 }]).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.tiles}>
          <div className={styles.tile}>
            <span className={styles.tileLabel}>Present</span>
            <span className={styles.tileValue}>{counts.present + counts.overtime}</span>
          </div>
          <div className={styles.tile}>
            <span className={styles.tileLabel}>Absent</span>
            <span className={styles.tileValue}>{counts.absent}</span>
          </div>
          <button
            type="button"
            aria-pressed={state.onlyOpen}
            className={`${styles.tile} ${styles.tileBtn} ${openTileClass}`}
            onClick={() => state.setOnlyOpen(!state.onlyOpen)}
          >
            <span className={styles.tileLabel}>Not marked</span>
            <span className={styles.tileValue}>{counts.not_marked}</span>
          </button>
        </div>
      </header>

      <div className={styles.body}>
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
        <div className={styles.pad}>
          <button type="button" className={styles.bigScan} onClick={state.openScanner}>
            <ScanIcon size={22} />
            Scan staff card
            <span lang="ne" className={styles.bigScanNp}>
              · कार्ड स्क्यान
            </span>
          </button>
        </div>
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
        <div className={styles.scopeRow}>
          <span className={styles.scope}>{state.scopeLabel}</span>
          {state.onlyOpen ? (
            <button type="button" className={styles.showAll} onClick={() => state.setOnlyOpen(false)}>
              Show all
            </button>
          ) : null}
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
          <Card key={row.employee.id} row={row} draft={draftOf(row)} state={state} />
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

      <div className={styles.stickyBar}>
        {counts.not_marked > 0 && !data?.day.is_weekly_off ? (
          <button type="button" className={styles.markRemaining} onClick={state.markAllPresent}>
            Mark remaining {counts.not_marked} as Present
          </button>
        ) : null}
        <div className={styles.saveRow}>
          <div className={styles.saveText}>
            <span className={styles.saveCaption}>
              {counts.not_marked ? `${counts.not_marked} still not marked` : "Everyone marked"}
              {state.message ? ` · ${state.message}` : ""}
            </span>
            <span className={styles.saveCount}>
              {marked} of {counts.total} marked
            </span>
          </div>
          <button
            type="button"
            className={styles.saveBtn}
            onClick={() => void state.save()}
            disabled={state.saving || state.loading || !state.dirty}
          >
            {state.saving ? "Saving…" : "Save attendance"}
          </button>
        </div>
      </div>

      {state.saved && state.today ? (
        <SavedScreen
          counts={state.saved.counts}
          branch={state.saved.branch}
          today={state.today}
          onClose={state.closeSaved}
        />
      ) : null}
      {menuOpen ? (
        <MobileDrawer
          user={user}
          modules={modules}
          onClose={() => setMenuOpen(false)}
          onLogout={() => void logout()}
        />
      ) : null}
    </div>
  );
}

function Card({ row, draft, state }: { row: MarkRow; draft: Draft; state: MarkState }) {
  const status = draft.status ?? "N";
  const e = row.employee;
  return (
    <article className={styles.card} data-status={status}>
      <div className={styles.cardHead}>
        <span className={styles.avatar} data-status={status} aria-hidden="true">
          {initials(e.name)}
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
      </div>
      <div role="group" aria-label={`Status for ${e.name}`} className={styles.cardBtns}>
        <button
          type="button"
          className={styles.cardBtn}
          data-status="P"
          aria-pressed={status === "P"}
          onClick={() => state.setStatus(e.id, "P")}
        >
          {STATUS_META.P.key} Present
        </button>
        <button
          type="button"
          className={styles.cardBtn}
          data-status="O"
          aria-pressed={status === "O"}
          aria-haspopup="dialog"
          onClick={() => state.openOvertime(e.id)}
        >
          {status === "O" ? `+ ${draft.ot_hours} h OT` : "+ Overtime"}
        </button>
        <button
          type="button"
          className={styles.cardBtn}
          data-status="A"
          aria-pressed={status === "A"}
          onClick={() => state.setStatus(e.id, "A")}
        >
          {STATUS_META.A.key} Absent
        </button>
      </div>
    </article>
  );
}
