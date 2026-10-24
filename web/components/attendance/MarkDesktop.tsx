"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { BsDateInput } from "@/components/ui/BsDateInput";
import { PageHeader } from "@/components/ui/PageHeader";
import { MarkRow } from "./MarkRow";
import { Pager } from "./Pager";
import { ScanIcon, SearchIcon } from "./icons";
import { isSheetStep } from "./scan/scanFlow";
import { unlockAudio } from "./speak";
import { DESKTOP_PAGE, type MarkState } from "./useMarkState";
import { VoiceControls } from "./VoiceControls";
import shared from "./shared.module.css";
import styles from "./mark.module.css";

export function MarkDesktop({ state }: { state: MarkState }) {
  const {
    data,
    loading,
    error,
    message,
    counts,
    scopeLabel,
    paged,
    listRows,
    draftOf,
    dirty,
    dirtyCount,
    saving,
  } = state;
  const scanInput = useRef<HTMLInputElement>(null);
  const ready = data !== null;
  const step = state.scan?.step;
  // Done / paid keep the box focused so the next card is read at once (the sheet shows only a countdown).
  const sheetHoldsFocus = isSheetStep(step) && step !== "done" && step !== "paid";

  // The scan box is the focused field: USB scanners type into it and press Enter.
  // Refocus after every sheet closes and when the window regains focus, but never
  // steal it from a custom-amount box.
  useEffect(() => {
    if (!ready || sheetHoldsFocus) return;
    const focusBox = () => {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement && active.getAttribute("aria-label") === "Custom amount") return;
      scanInput.current?.focus();
    };
    focusBox();
    window.addEventListener("focus", focusBox);
    return () => window.removeEventListener("focus", focusBox);
  }, [ready, sheetHoldsFocus]);

  const lastLine =
    step === "camera" && state.scan && "last" in state.scan && state.scan.last
      ? `${state.scan.last} — ready for next card · scanned ${state.scanCount}`
      : state.scan && state.scanCount > 0
        ? `Ready for next card · scanned ${state.scanCount}`
        : null;

  const onScanKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const value = event.currentTarget.value;
    event.currentTarget.value = "";
    state.submitCode(value);
  };

  const weeklyOff = data?.day.is_weekly_off ?? false;

  return (
    <>
      <PageHeader
        title="Mark attendance"
        subtitle="Pick a branch, narrow down, mark, save. Unsaved changes stay when you switch pages."
        actions={
          <div className={styles.dateCol}>
            <BsDateInput name="date" label="Date (BS)" value={state.date} onChange={state.setDate} />
          </div>
        }
      />

      <section aria-label="Filters" className={`card ${styles.filters}`}>
        <div className={styles.filterCol}>
          <label htmlFor="mark-branch" className={shared.label}>
            Branch
          </label>
          <div className={shared.field}>
            <select
              id="mark-branch"
              value={state.branchId}
              onChange={(e) => state.setBranch(Number(e.target.value))}
            >
              {(data?.branches ?? [{ id: state.branchId, name: "Loading…", headcount: 0 }]).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.headcount})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className={styles.filterCol}>
          <label htmlFor="mark-department" className={shared.label}>
            Department
          </label>
          <div className={shared.field}>
            <select
              id="mark-department"
              value={state.departmentId ?? ""}
              onChange={(e) => state.setDepartment(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">All departments</option>
              {(data?.departments ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.headcount})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className={`${styles.filterCol} ${styles.filterSearch}`}>
          <label htmlFor="mark-search" className={shared.label}>
            Search
          </label>
          <div className={shared.field}>
            <SearchIcon />
            <input
              id="mark-search"
              type="search"
              placeholder="Name or employee ID"
              value={state.query}
              onChange={(e) => state.setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className={`${styles.filterCol} ${styles.filterScan}`}>
          <label htmlFor="mark-scan" className={shared.label}>
            Scan staff card
          </label>
          <div className={styles.scanRow}>
            <div className={`${shared.field} ${styles.scanField}`}>
              <ScanIcon />
              <input
                id="mark-scan"
                ref={scanInput}
                placeholder="Click here, then scan (USB scanner) or type ID + Enter"
                autoComplete="off"
                onKeyDown={onScanKey}
                onPointerDown={unlockAudio}
                aria-describedby="mark-scan-hint"
              />
            </div>
            <VoiceControls variant="light" />
          </div>
          {lastLine ? (
            <span id="mark-scan-hint" role="status" className={styles.scanStatus}>
              {lastLine}
            </span>
          ) : (
            <span id="mark-scan-hint" className={styles.scanHint}>
              TTK-E004, E-004, E004 and 4 all open the same card
            </span>
          )}
        </div>
        <label className={shared.check}>
          <input
            type="checkbox"
            checked={state.onlyOpen}
            onChange={(e) => state.setOnlyOpen(e.target.checked)}
          />
          Only not marked
        </label>
      </section>

      <section aria-label="Day summary" className={styles.counts}>
        <span className={styles.cnt}>
          Present <strong>{counts.present + counts.overtime}</strong>
        </span>
        <span className={styles.cnt}>
          Absent <strong>{counts.absent}</strong>
        </span>
        <span className={`${styles.cnt} ${styles.cntOpen}`}>
          Not marked <strong>{counts.not_marked}</strong>
        </span>
        <span className={`${styles.cnt} ${styles.cntOt}`}>
          Overtime <strong>{counts.overtime_hours} h</strong> · {counts.overtime} staff
        </span>
        <span className={styles.scope}>for {scopeLabel}</span>
        <button
          type="button"
          className={`btn ${styles.markAll}`}
          onClick={state.markAllPresent}
          disabled={!data || counts.not_marked === 0 || weeklyOff}
        >
          Mark {counts.not_marked} not marked as present
        </button>
      </section>

      {error ? (
        <div className={styles.messages}>
          <p role="alert" className={shared.error}>
            {error}
          </p>
        </div>
      ) : null}
      {message ? (
        <div className={styles.messages}>
          <p role="status" className={shared.ok}>
            {message}
          </p>
        </div>
      ) : null}
      {weeklyOff ? (
        <div className={styles.messages}>
          <p role="status" className={shared.status}>
            {data?.day.bs_date} is the weekly off (Saturday). Nobody needs a mark; mark only staff who
            came in.
          </p>
        </div>
      ) : null}

      <form
        className={`card ${styles.form}`}
        onSubmit={(e) => {
          e.preventDefault();
          void state.save();
        }}
      >
        <div className={styles.scroll}>
          <table className={styles.table}>
            <caption className="sr-only">
              Attendance for {state.date} · {scopeLabel}
            </caption>
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Status</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {paged.items.map((row) => (
                <MarkRow
                  key={row.employee.id}
                  employee={row.employee}
                  draft={draftOf(row)}
                  onStatus={state.setStatus}
                  onOvertime={state.openOvertime}
                  onNote={state.setNote}
                />
              ))}
            </tbody>
          </table>
          {loading ? (
            <p className={styles.empty} role="status">
              Loading…
            </p>
          ) : !error && listRows.length === 0 ? (
            <p className={styles.empty}>Nobody matches. Clear the search or switch branch.</p>
          ) : null}
        </div>
        <div className={styles.footer}>
          <Pager
            page={paged.page}
            pages={paged.pages}
            onPage={state.setPage}
            label={`${paged.total} shown · ${DESKTOP_PAGE} per page`}
          />
          <div className={styles.footerRight}>
            <span className={styles.hint}>Overtime is paid hourly · rate set per employee</span>
            <button type="submit" className="btn btn--primary" disabled={saving || loading || !dirty}>
              {saving ? "Saving…" : dirty ? `Save attendance (${dirtyCount})` : "Save attendance"}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
