"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getDay,
  getMonthBalance,
  getPaymentHistoryFor,
  getToday,
  lookupCode,
  recordPayment,
  saveDay,
  scanMark,
} from "./api";
import {
  EMPTY_DRAFT,
  clampHours,
  countMarks,
  matchesQuery,
  paginate,
  sameDraft,
  type Draft,
  type MarkCounts,
} from "./helpers";
import type { Scan, ScanFlow } from "./scan/scanFlow";
import { useScanFlow } from "./scan/useScanFlow";
import { SPEECH, beep as rawBeep, speak as rawSpeak, unlockAudio } from "./speak";

// Sound is a courtesy: nothing in the scan/save chain may depend on it.
const say = (phrase: Parameters<typeof rawSpeak>[0]) => {
  try {
    void rawSpeak(phrase);
  } catch {
    // speak() never throws, but the save path must not rely on that.
  }
};
const beep = (kind: "ok" | "error" | "skip") => {
  try {
    rawBeep(kind);
  } catch {
    // Same.
  }
};
import { useUnsavedWarning } from "./useUnsavedWarning";
import type {
  AttendanceRecord,
  DayAttendance,
  MarkInput,
  MarkRow,
  TodayRef,
} from "./types";

export const DEFAULT_BRANCH = 1;
/** Desktop table page size (design: "10 per page"). */
export const DESKTOP_PAGE = 10;
/** Phone list: first batch and each "Show more". */
export const MOBILE_BATCH = 8;

type Drafts = Map<number, Draft>;

export function draftFromRecord(record: AttendanceRecord | null): Draft {
  if (!record) return EMPTY_DRAFT;
  return { status: record.status, ot_hours: record.ot_hours, note: record.note };
}

// ------------------------------------------------------------ the hook

export interface MarkState {
  // calendar / scope
  today: TodayRef | null;
  date: string;
  setDate: (value: string) => void;
  branchId: number;
  setBranch: (id: number) => void;
  departmentId: number | null;
  setDepartment: (id: number | null) => void;
  query: string;
  setQuery: (q: string) => void;
  onlyOpen: boolean;
  setOnlyOpen: (v: boolean) => void;
  // data
  data: DayAttendance | null;
  loading: boolean;
  error: string | null;
  message: string | null;
  clearMessage: () => void;
  // rows
  scopeRows: MarkRow[];
  listRows: MarkRow[];
  draftOf: (row: MarkRow) => Draft;
  counts: MarkCounts;
  scopeLabel: string;
  dirty: boolean;
  dirtyCount: number;
  // desktop paging / phone batches
  page: number;
  setPage: (p: number) => void;
  paged: ReturnType<typeof paginate<MarkRow>>;
  limit: number;
  showMore: () => void;
  // marking
  setStatus: (employeeId: number, status: "P" | "A") => void;
  setNote: (employeeId: number, note: string) => void;
  markAllPresent: () => void;
  otModal: { employeeId: number; hours: number } | null;
  openOvertime: (employeeId: number) => void;
  setOvertimeHours: (hours: number) => void;
  cancelOvertime: () => void;
  saveOvertime: () => void;
  // saving
  saving: boolean;
  save: () => Promise<boolean>;
  saved: { counts: MarkCounts; branch: string } | null;
  closeSaved: () => void;
  // scan flow (scan/scanFlow.ts)
  scan: Scan | null;
  /** People handled since the scanner was opened. */
  scanCount: number;
  flow: ScanFlow;
  /** Open the camera (phone); unlocks audio on that first tap. */
  openScanner: () => void;
  /** A code from the USB scanner / type-ID box. */
  submitCode: (code: string) => void;
}

export function useMarkState(options: { phone: boolean }): MarkState {
  const { phone } = options;
  const [today, setToday] = useState<TodayRef | null>(null);
  const [date, setDateRaw] = useState("");
  const [branchId, setBranchId] = useState(DEFAULT_BRANCH);
  const [departmentId, setDepartmentIdRaw] = useState<number | null>(null);
  const [query, setQueryRaw] = useState("");
  const [onlyOpen, setOnlyOpenRaw] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(MOBILE_BATCH);

  const [data, setData] = useState<DayAttendance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Drafts>(() => new Map());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<MarkState["saved"]>(null);
  const [otModal, setOtModal] = useState<MarkState["otModal"]>(null);

  // Default date = today (BS).
  useEffect(() => {
    let cancelled = false;
    getToday().then((t) => {
      if (cancelled) return;
      setToday(t);
      setDateRaw((current) => current || t.bs_date);
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

  const rowsById = useMemo(() => {
    const map = new Map<number, MarkRow>();
    for (const row of data?.rows ?? []) map.set(row.employee.id, row);
    return map;
  }, [data]);
  const rowsRef = useRef(rowsById);
  rowsRef.current = rowsById;
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  const draftOf = useCallback(
    (row: MarkRow): Draft => drafts.get(row.employee.id) ?? draftFromRecord(row.record),
    [drafts],
  );

  const patchDraft = useCallback((employeeId: number, patch: Partial<Draft>) => {
    setDrafts((current) => {
      const row = rowsRef.current.get(employeeId);
      if (!row) return current;
      const base = current.get(employeeId) ?? draftFromRecord(row.record);
      const nextDraft = { ...base, ...patch };
      const next = new Map(current);
      if (sameDraft(nextDraft, draftFromRecord(row.record))) next.delete(employeeId);
      else next.set(employeeId, nextDraft);
      return next;
    });
    setMessage(null);
  }, []);

  // ---- scope, counts, list

  const scopeRows = useMemo(
    () =>
      (data?.rows ?? []).filter(
        (row) => departmentId === null || row.employee.department_id === departmentId,
      ),
    [data, departmentId],
  );

  const counts = useMemo(() => countMarks(scopeRows.map(draftOf)), [scopeRows, draftOf]);

  const listRows = useMemo(
    () =>
      scopeRows.filter(
        (row) => matchesQuery(row.employee, query) && (!onlyOpen || draftOf(row).status === null),
      ),
    [scopeRows, query, onlyOpen, draftOf],
  );

  const paged = useMemo(() => paginate(listRows, page, DESKTOP_PAGE), [listRows, page]);

  const branch = data?.branches.find((b) => b.id === branchId);
  const department = data?.departments.find((d) => d.id === departmentId);
  const scopeLabel = phone
    ? `${department ? department.name : "All departments"} · ${listRows.length} ${onlyOpen ? "not marked" : "staff"}`
    : `${branch?.name ?? "…"}, ${department ? department.name : "all departments"} · ${scopeRows.length} staff`;

  const resetList = () => {
    setPage(1);
    setLimit(MOBILE_BATCH);
  };

  // ---- setters with discard checks

  const setDate = (value: string) => {
    if (value === date) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      setDateRaw(value);
      return;
    }
    if (confirmDiscard()) {
      setDateRaw(value);
      resetList();
    }
  };
  const setBranch = (id: number) => {
    if (id === branchId || !confirmDiscard()) return;
    setBranchId(id);
    setDepartmentIdRaw(null);
    resetList();
  };
  const setDepartment = (id: number | null) => {
    setDepartmentIdRaw(id);
    resetList();
  };
  const setQuery = (q: string) => {
    setQueryRaw(q);
    resetList();
  };
  const setOnlyOpen = (v: boolean) => {
    setOnlyOpenRaw(v);
    resetList();
  };

  // ---- marking

  const setStatus = useCallback(
    (employeeId: number, status: "P" | "A") => patchDraft(employeeId, { status, ot_hours: 0 }),
    [patchDraft],
  );
  const setNote = useCallback(
    (employeeId: number, note: string) => patchDraft(employeeId, { note }),
    [patchDraft],
  );

  const markAllPresent = () => {
    setDrafts((current) => {
      const next = new Map(current);
      for (const row of scopeRows) {
        const draft = current.get(row.employee.id) ?? draftFromRecord(row.record);
        if (draft.status === null) next.set(row.employee.id, { ...draft, status: "P", ot_hours: 0 });
      }
      return next;
    });
    if (phone) setOnlyOpenRaw(false);
    setMessage(null);
  };

  const openOvertime = useCallback((employeeId: number) => {
    const row = rowsRef.current.get(employeeId);
    if (!row) return;
    const draft = draftsRef.current.get(employeeId) ?? draftFromRecord(row.record);
    setOtModal({ employeeId, hours: draft.status === "O" ? draft.ot_hours : clampHours(draft.ot_hours || 1) });
  }, []);
  const setOvertimeHours = (hours: number) =>
    setOtModal((m) => (m ? { ...m, hours: clampHours(hours) } : m));
  const cancelOvertime = () => setOtModal(null);
  const saveOvertime = () => {
    if (!otModal) return;
    patchDraft(otModal.employeeId, { status: "O", ot_hours: clampHours(otModal.hours) });
    setOtModal(null);
  };

  // ---- saving

  const applyRecords = useCallback((records: AttendanceRecord[]) => {
    const byId = new Map(records.map((r) => [r.employee_id, r]));
    setData((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((row) =>
              byId.has(row.employee.id) ? { ...row, record: byId.get(row.employee.id)! } : row,
            ),
          }
        : current,
    );
    setDrafts((current) => {
      const next = new Map(current);
      for (const id of byId.keys()) next.delete(id);
      return next;
    });
  }, []);

  const save = async (): Promise<boolean> => {
    if (!data) return false;
    const rows: MarkInput[] = [];
    let skipped = 0;
    for (const [employeeId, draft] of drafts) {
      if (draft.status === null) {
        skipped += 1;
        continue;
      }
      rows.push({
        employee_id: employeeId,
        status: draft.status,
        ot_hours: draft.status === "O" ? draft.ot_hours : 0,
        note: draft.note.trim(),
      });
    }
    if (!rows.length) {
      setMessage(skipped ? "Pick a status before saving." : "Nothing to save.");
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await saveDay({ date_bs: data.day.bs_date, rows });
      applyRecords(result.records);
      setMessage(
        `Saved ${result.saved} ${result.saved === 1 ? "record" : "records"}` +
          (skipped ? ` · ${skipped} without a status not saved` : ""),
      );
      if (phone) {
        // Snapshot of the scope after the save, for the "Attendance saved" screen.
        const after = scopeRows.map((row) => {
          const saved = result.records.find((r) => r.employee_id === row.employee.id);
          return saved ? draftFromRecord(saved) : draftOf(row);
        });
        setSaved({ counts: countMarks(after), branch: branch?.name ?? "" });
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save attendance.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  // ---- scan flow (scan/scanFlow.ts)

  const currentMonthKey = today?.bs_date.slice(0, 7) ?? "";
  const { state: scanState, flow } = useScanFlow(
    {
      api: {
        lookup: lookupCode,
        mark: scanMark,
        balance: (id) => getMonthBalance(id, currentMonthKey),
        history: (id) => getPaymentHistoryFor(id, currentMonthKey),
        pay: recordPayment,
      },
      currentDraft: (emp, todayRecord) =>
        draftsRef.current.get(emp.id) ??
        draftFromRecord(todayRecord ?? rowsRef.current.get(emp.id)?.record ?? null),
      onMarked: (result) => {
        // Only rows of the loaded branch are on screen; a scan of someone else still saves.
        if (rowsRef.current.has(result.employee.id) && data?.day.bs_date === result.record.date_bs) {
          applyRecords([result.record]);
        }
      },
      monthKey: () => currentMonthKey,
      sounds: {
        read: () => beep("ok"),
        name: (e) => say(SPEECH.name(e)),
        already: (e) => say(SPEECH.already(e)),
        marked: (status, hours) => {
          beep("ok");
          say(status === "O" ? SPEECH.overtime(hours) : SPEECH.present());
        },
        paid: (e, type, amount) => {
          beep("ok");
          say(SPEECH.payment(e, type, amount));
        },
        unknown: () => {
          beep("error");
          say(SPEECH.unknown());
        },
        skip: () => beep("skip"),
      },
    },
    { trapBack: phone },
  );

  return {
    today,
    date,
    setDate,
    branchId,
    setBranch,
    departmentId,
    setDepartment,
    query,
    setQuery,
    onlyOpen,
    setOnlyOpen,
    data,
    loading,
    error,
    message,
    clearMessage: () => setMessage(null),
    scopeRows,
    listRows,
    draftOf,
    counts,
    scopeLabel,
    dirty,
    dirtyCount: drafts.size,
    page,
    setPage,
    paged,
    limit,
    showMore: () => setLimit((n) => n + MOBILE_BATCH),
    setStatus,
    setNote,
    markAllPresent,
    otModal,
    openOvertime,
    setOvertimeHours,
    cancelOvertime,
    saveOvertime,
    saving,
    save,
    saved,
    closeSaved: () => setSaved(null),
    scan: scanState.scan,
    scanCount: scanState.count,
    flow,
    openScanner: () => {
      unlockAudio();
      flow.open();
    },
    submitCode: (code) => flow.scan(code),
  };
}
