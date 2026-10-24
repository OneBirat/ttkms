"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AttendanceApiError,
  getDay,
  getMonthBalance,
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
import { SPEECH, beep, speak } from "./speak";
import { useUnsavedWarning } from "./useUnsavedWarning";
import type {
  AttendanceRecord,
  DayAttendance,
  EmployeeRef,
  MarkInput,
  MarkRow,
  MarkStatus,
  MonthBalance,
  PaymentMethod,
  PaymentResult,
  PaymentType,
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

// ------------------------------------------------------------ scan flow

/** "lookup" = a code typed on the desktop is being looked up (no overlay yet). */
export type ScanStep = "camera" | "lookup" | "found" | "already" | "pay" | "paid" | "missing" | "done";

export interface ScanState {
  step: ScanStep;
  /** The code as scanned or typed. */
  code: string;
  employee: EmployeeRef | null;
  /** What the server has for today (before this scan). */
  today: AttendanceRecord | null;
  /** The status the sheet treats as current (server record or an unsaved mark). */
  current: Draft;
  busy: boolean;
  error: string | null;
  // found
  otMode: boolean;
  hours: number;
  // already / pay
  balance: MonthBalance | null;
  ptype: PaymentType | null;
  /** Which quick amount is selected: "500", "full", "custom", … */
  quick: string | null;
  /** Custom amount as typed (digits only). */
  amount: string;
  method: PaymentMethod;
  paid: PaymentResult | null;
  // done
  doneStatus: MarkStatus | null;
  doneHours: number;
}

function freshScan(step: ScanStep, code = ""): ScanState {
  return {
    step,
    code,
    employee: null,
    today: null,
    current: EMPTY_DRAFT,
    busy: false,
    error: null,
    otMode: false,
    hours: 1,
    balance: null,
    ptype: null,
    quick: null,
    amount: "",
    method: "cash",
    paid: null,
    doneStatus: null,
    doneHours: 0,
  };
}

/** Rupees the pay sheet is about to save: the quick pick or the custom amount. */
export function scanAmount(scan: ScanState): number {
  if (scan.quick === "custom" || scan.quick === null) return Number.parseInt(scan.amount || "0", 10) || 0;
  if (scan.quick === "full") return scan.balance?.due ?? 0;
  return Number.parseInt(scan.quick, 10) || 0;
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
  // scan flow
  scan: ScanState | null;
  openScanner: () => void;
  closeScan: () => void;
  submitCode: (code: string) => void;
  scanPresent: () => void;
  scanOtMode: (on: boolean) => void;
  scanHours: (hours: number) => void;
  scanSaveOvertime: () => void;
  scanChangeAttendance: () => void;
  scanChoosePayment: (type: PaymentType) => void;
  scanPayBack: () => void;
  scanQuick: (key: string) => void;
  scanAmountText: (text: string) => void;
  scanMethod: (method: PaymentMethod) => void;
  scanSavePayment: () => void;
  scanAgain: () => void;
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
  const [scan, setScan] = useState<ScanState | null>(null);

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

  // ---- scan flow

  const currentMonthKey = today?.bs_date.slice(0, 7) ?? "";

  const loadBalance = useCallback(
    (employeeId: number) => {
      if (!currentMonthKey) return;
      getMonthBalance(employeeId, currentMonthKey)
        .then((balance) =>
          setScan((s) => (s && s.employee?.id === employeeId ? { ...s, balance } : s)),
        )
        .catch((err: unknown) =>
          setScan((s) =>
            s && s.employee?.id === employeeId
              ? { ...s, error: err instanceof Error ? err.message : "Could not load the balance." }
              : s,
          ),
        );
    },
    [currentMonthKey],
  );

  const openScanner = () => setScan(freshScan("camera"));
  const closeScan = () => setScan(null);

  const submitCode = (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    beep("ok"); // the instant a code is read; the words follow once the sheet is open
    setScan((s) => ({ ...(s ?? freshScan("lookup")), code, busy: true, error: null }));
    lookupCode(code)
      .then((found) => {
        const row = rowsRef.current.get(found.employee.id);
        const draft =
          draftsRef.current.get(found.employee.id) ?? draftFromRecord(found.today ?? row?.record ?? null);
        const already = draft.status !== null;
        setScan({
          ...freshScan(already ? "already" : "found", code),
          employee: found.employee,
          today: found.today,
          current: draft,
          hours: draft.status === "O" ? draft.ot_hours : 1,
        });
        if (already) {
          loadBalance(found.employee.id);
          void speak(SPEECH.already(found.employee));
        }
      })
      .catch((err: unknown) => {
        if (err instanceof AttendanceApiError && err.status === 404) {
          setScan(freshScan("missing", code));
          beep("error");
          void speak(SPEECH.unknown());
        } else {
          setScan((s) =>
            s ? { ...s, busy: false, error: err instanceof Error ? err.message : "Lookup failed." } : s,
          );
        }
      });
  };

  const commitScan = (action: "present" | "overtime", hours: number) => {
    setScan((s) => (s ? { ...s, busy: true, error: null } : s));
    const code = scan?.code ?? "";
    scanMark({ code, action, ot_hours: action === "overtime" ? hours : 0 })
      .then((result) => {
        // Only rows of the loaded branch are on screen; a scan of someone else still saves.
        if (rowsRef.current.has(result.employee.id) && data?.day.bs_date === result.record.date_bs) {
          applyRecords([result.record]);
        }
        setScan((s) =>
          s
            ? {
                ...s,
                step: "done",
                busy: false,
                doneStatus: result.record.status,
                doneHours: result.record.ot_hours,
                today: result.record,
              }
            : s,
        );
        void speak(
          result.record.status === "O"
            ? SPEECH.overtime(result.employee, result.record.ot_hours)
            : SPEECH.present(result.employee),
        );
      })
      .catch((err: unknown) =>
        setScan((s) =>
          s ? { ...s, busy: false, error: err instanceof Error ? err.message : "Could not save the scan." } : s,
        ),
      );
  };

  const scanPresent = () => commitScan("present", 0);
  const scanOtMode = (on: boolean) => setScan((s) => (s ? { ...s, otMode: on } : s));
  const scanHours = (hours: number) => setScan((s) => (s ? { ...s, hours: clampHours(hours) } : s));
  const scanSaveOvertime = () => commitScan("overtime", clampHours(scan?.hours ?? 1));
  const scanChangeAttendance = () => setScan((s) => (s ? { ...s, step: "found", otMode: false } : s));

  const scanChoosePayment = (type: PaymentType) =>
    setScan((s) =>
      s
        ? {
            ...s,
            step: "pay",
            ptype: type,
            quick: type === "salary" ? "full" : null,
            amount: "",
            method: "cash",
            error: null,
          }
        : s,
    );
  const scanPayBack = () => setScan((s) => (s ? { ...s, step: "already", error: null } : s));
  const scanQuick = (key: string) =>
    setScan((s) => (s ? { ...s, quick: key, amount: key === "custom" ? "" : s.amount, error: null } : s));
  const scanAmountText = (text: string) =>
    setScan((s) => (s ? { ...s, amount: text.replace(/[^0-9]/g, "").slice(0, 9), error: null } : s));
  const scanMethod = (method: PaymentMethod) => setScan((s) => (s ? { ...s, method } : s));

  const scanSavePayment = () => {
    if (!scan || !scan.employee || !scan.ptype || !scan.balance) return;
    const amount = scanAmount(scan);
    const employee = scan.employee;
    setScan((s) => (s ? { ...s, busy: true, error: null } : s));
    recordPayment({
      employee_id: employee.id,
      month_key: scan.balance.month_key,
      type: scan.ptype,
      amount,
      method: scan.method,
      source: "scan",
    })
      .then((paid) => {
        setScan((s) => (s ? { ...s, step: "paid", busy: false, paid } : s));
        loadBalance(employee.id);
        void speak(SPEECH.payment(employee, scan.ptype!, paid.amount));
      })
      .catch((err: unknown) =>
        setScan((s) =>
          s ? { ...s, busy: false, error: err instanceof Error ? err.message : "Could not record the payment." } : s,
        ),
      );
  };

  /** "Scan next" / "Scan again": the camera on a phone, the USB input on a desktop. */
  const scanAgain = () => (phone ? setScan(freshScan("camera")) : setScan(null));

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
    scan,
    openScanner,
    closeScan,
    submitCode,
    scanPresent,
    scanOtMode,
    scanHours,
    scanSaveOvertime,
    scanChangeAttendance,
    scanChoosePayment,
    scanPayBack,
    scanQuick,
    scanAmountText,
    scanMethod,
    scanSavePayment,
    scanAgain,
  };
}
