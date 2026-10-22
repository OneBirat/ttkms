"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BsDateInput } from "@/components/ui/BsDateInput";
import { PageHeader } from "@/components/ui/PageHeader";
import { AttendanceApiError, getDay, getToday, saveDay } from "./api";
import { MarkRow, type RowDraft } from "./MarkRow";
import { Pager } from "./Pager";
import { useUnsavedWarning } from "./useUnsavedWarning";
import { emptyCounts, isValidTime, matchesQuery, paginate, type StatusCounts } from "./helpers";
import type { AttendanceStatus, DayAttendance, MarkInput, MarkRow as MarkRowData } from "./types";
import shared from "./shared.module.css";
import styles from "./mark.module.css";

const DEFAULT_BRANCH = 1;
const DEFAULT_PER_PAGE = 25;

type Drafts = Map<number, RowDraft>;

function draftFromRecord(row: MarkRowData): RowDraft {
  const r = row.record;
  return {
    status: r?.status ?? null,
    in_time: r?.in_time ?? "",
    out_time: r?.out_time ?? "",
    note: r?.note ?? "",
  };
}

function effectiveDraft(row: MarkRowData, drafts: Drafts): RowDraft {
  return drafts.get(row.employee.id) ?? draftFromRecord(row);
}

function sameDraft(a: RowDraft, b: RowDraft): boolean {
  return (
    a.status === b.status && a.in_time === b.in_time && a.out_time === b.out_time && a.note === b.note
  );
}

export function MarkPage() {
  const [date, setDate] = useState<string>("");
  const [branchId, setBranchId] = useState(DEFAULT_BRANCH);
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(DEFAULT_PER_PAGE);

  const [data, setData] = useState<DayAttendance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Drafts>(() => new Map());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Default date = today (BS) from the API.
  useEffect(() => {
    let cancelled = false;
    getToday().then((today) => {
      if (!cancelled) setDate((current) => current || today.bs_date);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the day whenever date or branch changes; drafts belong to one load.
  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getDay(date, branchId)
      .then((body) => {
        if (cancelled) return;
        setData(body);
        setDrafts(new Map());
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load attendance.");
        setData(null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date, branchId]);

  const dirty = drafts.size > 0;
  useUnsavedWarning(dirty);

  const confirmDiscard = useCallback(
    () => !dirty || window.confirm("Discard unsaved attendance changes?"),
    [dirty],
  );

  const onDate = (value: string) => {
    if (value === date) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      setDate(value);
      return;
    }
    if (confirmDiscard()) {
      setDate(value);
      setPage(1);
    }
  };

  const onBranch = (value: number) => {
    if (value === branchId || !confirmDiscard()) return;
    setBranchId(value);
    setDepartmentId(null);
    setPage(1);
  };

  // Stable lookup for the row callback (rows change only on load).
  const rowsById = useMemo(() => {
    const map = new Map<number, MarkRowData>();
    for (const row of data?.rows ?? []) map.set(row.employee.id, row);
    return map;
  }, [data]);
  const rowsRef = useRef(rowsById);
  rowsRef.current = rowsById;

  const onChangeRow = useCallback((employeeId: number, patch: Partial<RowDraft>) => {
    setDrafts((current) => {
      const row = rowsRef.current.get(employeeId);
      if (!row) return current;
      const base = current.get(employeeId) ?? draftFromRecord(row);
      const nextDraft = { ...base, ...patch };
      const next = new Map(current);
      if (sameDraft(nextDraft, draftFromRecord(row))) next.delete(employeeId);
      else next.set(employeeId, nextDraft);
      return next;
    });
    setMessage(null);
  }, []);

  const scopeRows = useMemo(
    () =>
      (data?.rows ?? []).filter(
        (row) => departmentId === null || row.employee.department_id === departmentId,
      ),
    [data, departmentId],
  );

  const counts = useMemo<StatusCounts>(() => {
    const c = emptyCounts();
    for (const row of scopeRows) c[effectiveDraft(row, drafts).status ?? "not_marked"] += 1;
    return c;
  }, [scopeRows, drafts]);

  const listRows = useMemo(
    () =>
      scopeRows.filter(
        (row) =>
          matchesQuery(row.employee, query) &&
          (!onlyOpen || effectiveDraft(row, drafts).status === null),
      ),
    [scopeRows, query, onlyOpen, drafts],
  );

  const paged = paginate(listRows, page, perPage);

  const markAllPresent = () => {
    setDrafts((current) => {
      const next = new Map(current);
      for (const row of scopeRows) {
        const draft = effectiveDraft(row, current);
        if (draft.status === null) next.set(row.employee.id, { ...draft, status: "present" });
      }
      return next;
    });
  };

  const save = async () => {
    if (!data) return;
    const marks: MarkInput[] = [];
    let skipped = 0;
    let badTime = 0;
    for (const [employeeId, draft] of drafts) {
      if (draft.status === null) {
        skipped += 1;
        continue;
      }
      const inTime = draft.in_time.trim();
      const outTime = draft.out_time.trim();
      if ((inTime && !isValidTime(inTime)) || (outTime && !isValidTime(outTime))) {
        badTime += 1;
        continue;
      }
      marks.push({
        employee_id: employeeId,
        status: draft.status as AttendanceStatus,
        in_time: inTime || null,
        out_time: outTime || null,
        note: draft.note.trim(),
      });
    }
    if (badTime) {
      setError(`${badTime} row(s) have a time that is not HH:MM.`);
      return;
    }
    if (!marks.length) {
      setMessage(skipped ? "Pick a status before saving." : "Nothing to save.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await saveDay({ date: data.day.bs_date, marks });
      const byId = new Map(result.records.map((r) => [r.employee_id, r]));
      setData({
        ...data,
        rows: data.rows.map((row) =>
          byId.has(row.employee.id) ? { ...row, record: byId.get(row.employee.id)! } : row,
        ),
      });
      setDrafts((current) => {
        const next = new Map(current);
        for (const id of byId.keys()) next.delete(id);
        return next;
      });
      setMessage(
        `Saved ${result.saved} ${result.saved === 1 ? "record" : "records"}` +
          (skipped ? ` · ${skipped} without a status not saved` : ""),
      );
    } catch (err) {
      setError(
        err instanceof AttendanceApiError || err instanceof Error
          ? err.message
          : "Could not save attendance.",
      );
    } finally {
      setSaving(false);
    }
  };

  const branch = data?.branches.find((b) => b.id === branchId);
  const department = data?.departments.find((d) => d.id === departmentId);
  const scopeLabel = `${branch?.name ?? "…"}, ${department ? department.name : "all departments"} · ${scopeRows.length} staff`;

  return (
    <>
      <PageHeader
        title="Mark attendance"
        subtitle="Pick a branch, narrow down, mark, save. Unsaved changes stay when you switch pages."
        actions={
          <div className={styles.dateCol}>
            <BsDateInput name="date" label="Date (BS)" value={date} onChange={onDate} />
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
              value={branchId}
              onChange={(e) => onBranch(Number(e.target.value))}
            >
              {(data?.branches ?? [{ id: branchId, name: "Loading…", headcount: 0 }]).map((b) => (
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
              value={departmentId ?? ""}
              onChange={(e) => {
                setDepartmentId(e.target.value ? Number(e.target.value) : null);
                setPage(1);
              }}
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
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
        <label className={shared.check}>
          <input
            type="checkbox"
            checked={onlyOpen}
            onChange={(e) => {
              setOnlyOpen(e.target.checked);
              setPage(1);
            }}
          />
          Only not marked
        </label>
      </section>

      <section aria-label="Day summary" className={styles.counts}>
        <span className={styles.cnt}>
          Present <strong>{counts.present}</strong>
        </span>
        <span className={styles.cnt}>
          Late <strong>{counts.late}</strong>
        </span>
        <span className={styles.cnt}>
          Half <strong>{counts.half_day}</strong>
        </span>
        <span className={styles.cnt}>
          Leave <strong>{counts.leave}</strong>
        </span>
        <span className={styles.cnt}>
          Absent <strong>{counts.absent}</strong>
        </span>
        <span className={`${styles.cnt} ${styles.cntOpen}`}>
          Not marked <strong>{counts.not_marked}</strong>
        </span>
        <span className={styles.scope}>for {scopeLabel}</span>
        <button
          type="button"
          className={`btn ${styles.markAll}`}
          onClick={markAllPresent}
          disabled={!data || counts.not_marked === 0 || data.day.is_weekly_off}
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
      {data?.day.is_weekly_off ? (
        <div className={styles.messages}>
          <p role="status" className={shared.status}>
            {data.day.bs_date} is the weekly off (Saturday); nothing to mark.
          </p>
        </div>
      ) : null}

      <form
        className={`card ${styles.form}`}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className={styles.scroll}>
          <table className={styles.table}>
            <caption className="sr-only">
              Attendance for {date} · {scopeLabel}
            </caption>
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Status</th>
                <th scope="col">In</th>
                <th scope="col">Out</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {paged.items.map((row) => (
                <MarkRow
                  key={row.employee.id}
                  employee={row.employee}
                  value={effectiveDraft(row, drafts)}
                  onChange={onChangeRow}
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
            onPage={setPage}
            label={`${paged.total} shown`}
            perPage={perPage}
            onPerPage={(n) => {
              setPerPage(n);
              setPage(1);
            }}
          />
          <div className={styles.footerRight}>
            <span className={styles.hint}>
              Late after {data?.settings.late_after ?? "09:30"} · set in Settings
            </span>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={saving || loading || !dirty}
            >
              {saving ? "Saving…" : dirty ? `Save attendance (${drafts.size})` : "Save attendance"}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}

function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}
