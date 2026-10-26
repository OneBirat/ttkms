"use client";

import { withBranch } from "@/lib/branchContext";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { BSDate } from "@/components/date";
import { PageHeader } from "@/components/ui/PageHeader";
import { CheckIcon, ScanIcon, SearchIcon } from "./icons";
import { MarkRow } from "./MarkRow";
import { Pager } from "./Pager";
import { isSheetStep } from "./scan/scanFlow";
import { unlockAudio } from "./speak";
import { DESKTOP_PAGE, type MarkState } from "./useMarkState";
import { VoiceControls } from "./VoiceControls";
import type { StatusFilter } from "./helpers";
import shared from "./shared.module.css";
import styles from "./mark.module.css";

const PILLS: { key: StatusFilter; label: string }[] = [
  { key: "", label: "All" },
  { key: "N", label: "Not marked" },
  { key: "P", label: "Present" },
  { key: "A", label: "Absent" },
];

/** Mark attendance, desktop (design/final/AttendanceMark.dc.html). */
export function MarkDesktop({ state }: { state: MarkState }) {
  const router = useRouter();
  const { data, loading, error, counts, scopeLabel, paged, listRows, statusFilter, selected } = state;
  const scanInput = useRef<HTMLInputElement>(null);
  const ready = data !== null;
  const step = state.scan?.step;
  // Done / paid keep the box focused so the next card is read at once (the sheet shows only a countdown).
  const sheetHoldsFocus =
    (isSheetStep(step) && step !== "done" && step !== "paid") ||
    state.saved !== null ||
    state.otModal !== null;

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

  const onScanKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const value = event.currentTarget.value;
    event.currentTarget.value = "";
    state.submitCode(value);
  };

  const lastLine =
    step === "camera" && state.scan && "last" in state.scan && state.scan.last
      ? `${state.scan.last} — ready for next card · scanned ${state.scanCount}`
      : state.scan && state.scanCount > 0
        ? `Ready for next card · scanned ${state.scanCount}`
        : null;

  const bulk = statusFilter === "N";
  const canAll = state.departmentId !== null;
  const department = data?.departments.find((d) => d.id === state.departmentId);
  const openOnPage = paged.items.filter((row) => state.statusOf(row) === "N").map((row) => row.employee.id);
  const allOnPageSelected = openOnPage.length > 0 && openOnPage.every((id) => selected.has(id));
  const selectedOpen = state.scopeRows.filter((row) => selected.has(row.employee.id) && state.statusOf(row) === "N").length;
  const weeklyOff = data?.day.is_weekly_off ?? false;

  return (
    <>
      <PageHeader
        title={withBranch("Mark attendance", state.branchName ? { name: state.branchName } : null)}
        subtitle="Narrow down and mark. Each mark is saved as soon as you confirm it. The branch is switched in the sidebar."
        actions={
          <div className={styles.dateCol}>
            <BSDate
              label="Date"
              name="date"
              value={state.date}
              align="right"
              noFutureDays
              markedDays={state.markedDays}
              markedLabel="attendance marked"
              onChange={(bs) => state.setDate(bs)}
            />
          </div>
        }
      />

      <section aria-label="Filters" className={`card ${styles.filters}`}>
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
            checked={bulk}
            onChange={(e) => state.setStatusFilter(e.target.checked ? "N" : "")}
          />
          Only not marked
        </label>
      </section>

      <section role="group" aria-label="Department" className={styles.deptChips}>
        <button
          type="button"
          className={styles.deptChip}
          aria-pressed={state.departmentId === null}
          onClick={() => state.setDepartment(null)}
        >
          <span className={styles.deptChipName}>All departments</span>
          <span className={styles.deptChipCount}>{data?.rows.length ?? 0}</span>
        </button>
        {(data?.departments ?? []).map((d) => (
          <button
            key={d.id}
            type="button"
            className={styles.deptChip}
            aria-pressed={state.departmentId === d.id}
            onClick={() => state.setDepartment(d.id)}
          >
            <span className={styles.deptChipName}>{d.name}</span>
            <span className={styles.deptChipCount}>{d.headcount}</span>
          </button>
        ))}
      </section>

      <section aria-label="Day summary" className={styles.counts}>
        {PILLS.map((pill) => {
          const n =
            pill.key === ""
              ? counts.total
              : pill.key === "N"
                ? counts.not_marked
                : pill.key === "P"
                  ? counts.present + counts.overtime
                  : counts.absent;
          return (
            <button
              key={pill.key || "all"}
              type="button"
              className={styles.pill}
              data-filter={pill.key || "all"}
              aria-pressed={statusFilter === pill.key}
              onClick={() => state.setStatusFilter(statusFilter === pill.key ? "" : pill.key)}
            >
              {pill.label} <strong>{n}</strong>
            </button>
          );
        })}
        <button
          type="button"
          className={styles.pill}
          data-filter="O"
          aria-pressed={statusFilter === "O"}
          onClick={() => state.setStatusFilter(statusFilter === "O" ? "" : "O")}
        >
          Overtime <strong>{counts.overtime_hours} h</strong> · {counts.overtime} staff
        </button>
        <span className={styles.scope}>for {scopeLabel}</span>
        <label className={`${shared.check} ${styles.photosToggle}`}>
          <input type="checkbox" checked={state.photos} onChange={(e) => state.setPhotos(e.target.checked)} />
          Show employee photos
        </label>
      </section>

      {state.bulkMessage ? (
        <div role="status" className={styles.bulkMsg}>
          <div className={styles.bulkMsgHead}>
            <span className={styles.bulkMsgText}>✓ {state.bulkMessage.text}</span>
            <span className={styles.bulkSpacer} />
            <button type="button" aria-label="Close" className={styles.bulkMsgClose} onClick={state.closeBulkMessage}>
              ×
            </button>
          </div>
          <div className={styles.bulkChips}>
            {state.bulkMessage.names.map((name) => (
              <span key={name} className={styles.bulkChip}>
                <CheckIcon size={12} />
                {name}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className={styles.messages}>
          <p role="alert" className={shared.error}>
            {error}
          </p>
        </div>
      ) : null}
      {weeklyOff ? (
        <div className={styles.messages}>
          <p role="status" className={shared.status}>
            {data?.day.bs_date} is the weekly off (Saturday). Nobody needs a mark; mark only staff who came in.
          </p>
        </div>
      ) : null}

      <section className={`card ${styles.form}`} aria-label="Staff">
        <div className={styles.scroll}>
          <table className={styles.table}>
            <caption className="sr-only">
              Attendance for {state.date} · {scopeLabel}
            </caption>
            <thead>
              <tr>
                {bulk ? (
                  <th scope="col" className={styles.selectCol} title={canAll ? undefined : "Pick a department to select everyone on the page"}>
                    {canAll ? (
                      <input
                        type="checkbox"
                        aria-label="Select all not marked on this page"
                        checked={allOnPageSelected}
                        disabled={openOnPage.length === 0}
                        onChange={(e) => state.setSelected(openOnPage, e.target.checked)}
                      />
                    ) : null}
                  </th>
                ) : null}
                <th scope="col">Employee</th>
                <th scope="col">
                  {bulk ? (
                    <span className={styles.statusHead}>
                      Status
                      <span className={styles.bulkSpacer} />
                      <span className={styles.bulkCount} aria-live="polite">
                        <strong>{selectedOpen}</strong> selected
                      </span>
                      <button
                        type="button"
                        className={styles.bulkSelBtn}
                        disabled={selectedOpen === 0 || state.bulkBusy || weeklyOff}
                        onClick={state.markSelected}
                      >
                        Mark selected as Present
                      </button>
                      {canAll ? (
                        <button
                          type="button"
                          className={styles.bulkAllBtn}
                          disabled={state.bulkBusy || counts.not_marked === 0 || weeklyOff}
                          onClick={state.markDepartment}
                        >
                          Mark all {counts.not_marked} in {department?.name ?? ""} as Present
                        </button>
                      ) : null}
                    </span>
                  ) : (
                    "Status"
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {paged.items.map((row) => (
                <MarkRow
                  key={row.employee.id}
                  employee={row.employee}
                  status={state.statusOf(row)}
                  hours={row.record?.ot_hours ?? 0}
                  photos={state.photos}
                  bulk={bulk}
                  selected={selected.has(row.employee.id)}
                  pending={state.pending.has(row.employee.id)}
                  onToggleSelect={state.toggleSelected}
                  onPick={state.pickStatus}
                  onOvertime={state.openOvertime}
                  onOpenProfile={(id, dept) => router.push(`/people/employees/${id}?dept=${dept}`)}
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
        </div>
      </section>
    </>
  );
}
