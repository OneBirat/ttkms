"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/lib/session";
import {
  bulkMarkPresent,
  getDay,
  getEmployeeMonth,
  getMonthBalance,
  getPaymentHistoryFor,
  getToday,
  lookupCode,
  markOne,
  recordPayment,
  scanMark,
} from "./api";
import { addDays, adToBs, bsToAd, diffDays, isValidBs, isoBs } from "@/lib/bs";
import {
  clampHours,
  countMarks,
  matchesQuery,
  matchesStatusFilter,
  paginate,
  recordStatus,
  type Draft,
  type MarkCounts,
  type StatusFilter,
} from "./helpers";
import type { Scan, ScanFlow } from "./scan/scanFlow";
import { useScanFlow } from "./scan/useScanFlow";
import { SPEECH, beep as rawBeep, speak as rawSpeak, unlockAudio } from "./speak";
import type {
  AttendanceRecord,
  CellStatus,
  DayAttendance,
  MarkRow,
  MarkStatus,
  TodayRef,
} from "./types";

// Sound is a courtesy: nothing in the mark/save chain may depend on it.
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

export const DEFAULT_BRANCH = 1;
/** Desktop table page size (design: "10 per page"). */
export const DESKTOP_PAGE = 10;
/** Phone list: first batch and each "Show more". */
export const MOBILE_BATCH = 8;
/** The phone's "saved" sheet closes itself after this long. */
export const MANUAL_DONE_MS = 3000;

export function draftFromRecord(record: AttendanceRecord | null): Draft {
  if (!record) return { status: null, ot_hours: 0, note: "" };
  return { status: record.status, ot_hours: record.ot_hours, note: record.note };
}

/** Desktop: the "Saved as …" pop-up after a click (Edit lets you change it on the spot). */
export interface SavedConfirm {
  employeeId: number;
  status: MarkStatus;
  hours: number;
  previous: CellStatus;
  editing: boolean;
}

/** Phone: "Mark as Present?" before the save. */
export interface AskConfirm {
  employeeId: number;
  status: "P" | "A";
  previous: CellStatus;
}

/** Phone: the saved sheet (AttendanceManualDone) with its 3 s countdown. */
export interface ManualDone {
  employeeId: number;
  status: MarkStatus;
  hours: number;
  previous: CellStatus;
  token: number;
}

export interface BulkMessage {
  text: string;
  names: string[];
}

export interface MarkState {
  // who
  /** True when the user holds `see_other_branches` and may switch branch. */
  canPickBranch: boolean;
  // calendar / scope
  today: TodayRef | null;
  date: string;
  setDate: (value: string) => void;
  prevDay: () => void;
  nextDay: () => void;
  goToday: () => void;
  /** Days before today, 0 today. */
  daysAgo: number;
  isPast: boolean;
  calendarOpen: boolean;
  setCalendarOpen: (open: boolean) => void;
  branchId: number;
  setBranch: (id: number) => void;
  departmentId: number | null;
  setDepartment: (id: number | null) => void;
  query: string;
  setQuery: (q: string) => void;
  statusFilter: StatusFilter;
  setStatusFilter: (f: StatusFilter) => void;
  photos: boolean;
  setPhotos: (on: boolean) => void;
  // data
  data: DayAttendance | null;
  loading: boolean;
  error: string | null;
  clearError: () => void;
  // rows
  scopeRows: MarkRow[];
  listRows: MarkRow[];
  statusOf: (row: MarkRow) => CellStatus;
  draftOf: (row: MarkRow) => Draft;
  counts: MarkCounts;
  scopeLabel: string;
  pending: ReadonlySet<number>;
  // desktop paging / phone batches
  page: number;
  setPage: (p: number) => void;
  paged: ReturnType<typeof paginate<MarkRow>>;
  limit: number;
  showMore: () => void;
  // marking (every call saves at once)
  markNow: (employeeId: number, status: MarkStatus, hours?: number) => Promise<AttendanceRecord | null>;
  /** Desktop click on Present / Absent: save, then show the "Saved as" pop-up. */
  pickStatus: (employeeId: number, status: "P" | "A") => void;
  saved: SavedConfirm | null;
  savedEdit: () => void;
  savedChange: (status: MarkStatus) => void;
  savedClose: () => void;
  /** Phone tap on Present / Absent: ask first. */
  askStatus: (employeeId: number, status: "P" | "A") => void;
  ask: AskConfirm | null;
  askConfirm: () => void;
  askCancel: () => void;
  manualDone: ManualDone | null;
  manualDoneClose: () => void;
  otModal: { employeeId: number; hours: number } | null;
  openOvertime: (employeeId: number) => void;
  setOvertimeHours: (hours: number) => void;
  cancelOvertime: () => void;
  saveOvertime: () => void;
  // phone action sheet
  action: number | null;
  openAction: (employeeId: number) => void;
  closeAction: () => void;
  // bulk (desktop, "Not marked" filter)
  selected: ReadonlySet<number>;
  toggleSelected: (employeeId: number) => void;
  setSelected: (ids: number[], on: boolean) => void;
  bulkBusy: boolean;
  markSelected: () => void;
  markDepartment: () => void;
  bulkMessage: BulkMessage | null;
  closeBulkMessage: () => void;
  // scan flow (scan/scanFlow.ts)
  scan: Scan | null;
  scanCount: number;
  flow: ScanFlow;
  openScanner: () => void;
  submitCode: (code: string) => void;
  /** Open the scan flow's history / attendance-record sheets for a person without a scan (phone ⋮ menu). */
  openPayments: (employeeId: number) => void;
  openAttendanceRecord: (employeeId: number) => void;
}

export function useMarkState(options: { phone: boolean }): MarkState {
  const { phone } = options;
  const { branchId: homeBranch, can } = useSession();
  const canPickBranch = can("see_other_branches");

  const [today, setToday] = useState<TodayRef | null>(null);
  const [date, setDateRaw] = useState("");
  // Everyone starts on their own branch (session.branchId from admin.user_access).
  const [branchId, setBranchId] = useState(homeBranch ?? DEFAULT_BRANCH);
  const [departmentId, setDepartmentIdRaw] = useState<number | null>(null);
  const [query, setQueryRaw] = useState("");
  const [statusFilter, setStatusFilterRaw] = useState<StatusFilter>("");
  const [photos, setPhotos] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(MOBILE_BATCH);

  const [data, setData] = useState<DayAttendance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ReadonlySet<number>>(() => new Set());
  const [saved, setSaved] = useState<SavedConfirm | null>(null);
  const [ask, setAsk] = useState<AskConfirm | null>(null);
  const [manualDone, setManualDone] = useState<ManualDone | null>(null);
  const [otModal, setOtModal] = useState<MarkState["otModal"]>(null);
  const [action, setAction] = useState<number | null>(null);
  const [selected, setSelectedRaw] = useState<ReadonlySet<number>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<BulkMessage | null>(null);

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

  // Load the day whenever date or branch changes.
  useEffect(() => {
    if (!date || !isValidBs(date)) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getDay(date, branchId)
      .then((body) => {
        if (cancelled) return;
        setData(body);
        setSelectedRaw(new Set());
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

  const rowsById = useMemo(() => {
    const map = new Map<number, MarkRow>();
    for (const row of data?.rows ?? []) map.set(row.employee.id, row);
    return map;
  }, [data]);
  const rowsRef = useRef(rowsById);
  rowsRef.current = rowsById;

  const statusOf = useCallback((row: MarkRow): CellStatus => recordStatus(row.record), []);
  const draftOf = useCallback((row: MarkRow): Draft => draftFromRecord(row.record), []);

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
        (row) => matchesQuery(row.employee, query) && matchesStatusFilter(statusOf(row), statusFilter),
      ),
    [scopeRows, query, statusFilter, statusOf],
  );
  const paged = useMemo(() => paginate(listRows, page, DESKTOP_PAGE), [listRows, page]);

  const branch = data?.branches.find((b) => b.id === branchId);
  const department = data?.departments.find((d) => d.id === departmentId);
  const filterWord = { "": "staff", N: "not marked", P: "present", O: "overtime", A: "absent", W: "weekly off" }[statusFilter];
  const scopeLabel = phone
    ? `${department ? department.name : "All departments"} · ${listRows.length} ${filterWord}`
    : `${branch?.name ?? "…"}, ${department ? department.name : "all departments"} · ${scopeRows.length} staff`;

  const resetList = () => {
    setPage(1);
    setLimit(MOBILE_BATCH);
  };

  // ---- date navigation (BS first; arithmetic on the AD side)

  const todayBs = today?.bs_date ?? "";
  const daysAgo = useMemo(() => {
    if (!todayBs || !isValidBs(date)) return 0;
    return Math.max(0, diffDays(bsToAd(date), bsToAd(todayBs)));
  }, [date, todayBs]);
  const isPast = daysAgo > 0;
  const shiftDay = (delta: number) => {
    if (!isValidBs(date)) return;
    const ad = addDays(bsToAd(date), delta);
    if (todayBs && diffDays(bsToAd(todayBs), ad) > 0) return; // future days are locked
    const p = adToBs(ad);
    setDateRaw(isoBs(p.year, p.month, p.day));
    resetList();
  };

  const setDate = (value: string) => {
    if (value === date) return;
    setDateRaw(value);
    if (isValidBs(value)) resetList();
  };
  const setBranch = (id: number) => {
    if (id === branchId) return;
    setBranchId(id);
    setDepartmentIdRaw(null);
    resetList();
  };
  const setDepartment = (id: number | null) => {
    setDepartmentIdRaw(id);
    setSelectedRaw(new Set());
    resetList();
  };
  const setQuery = (q: string) => {
    setQueryRaw(q);
    resetList();
  };
  const setStatusFilter = (f: StatusFilter) => {
    setStatusFilterRaw(f);
    setSelectedRaw(new Set());
    resetList();
  };

  // ---- saving one person

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
  }, []);

  const markNow = useCallback(
    async (employeeId: number, status: MarkStatus, hours = 0): Promise<AttendanceRecord | null> => {
      if (!data) return null;
      setPending((p) => new Set(p).add(employeeId));
      setError(null);
      try {
        const result = await markOne({
          date_bs: data.day.bs_date,
          employee_id: employeeId,
          status,
          ot_hours: status === "O" ? clampHours(hours) : 0,
        });
        applyRecords([result.record]);
        setSelectedRaw((s) => {
          if (!s.has(employeeId)) return s;
          const next = new Set(s);
          next.delete(employeeId);
          return next;
        });
        return result.record;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save. Try again.");
        return null;
      } finally {
        setPending((p) => {
          const next = new Set(p);
          next.delete(employeeId);
          return next;
        });
      }
    },
    [data, applyRecords],
  );

  // Desktop: click → save → "Saved as" pop-up.
  const pickStatus = useCallback(
    (employeeId: number, status: "P" | "A") => {
      const row = rowsRef.current.get(employeeId);
      if (!row) return;
      const previous = recordStatus(row.record);
      void markNow(employeeId, status).then((record) => {
        if (record) setSaved({ employeeId, status, hours: 0, previous, editing: false });
      });
    },
    [markNow],
  );
  const savedEdit = () => setSaved((s) => (s ? { ...s, editing: !s.editing } : s));
  const savedChange = (status: MarkStatus) => {
    if (!saved) return;
    if (status === "O") {
      setOtModal({ employeeId: saved.employeeId, hours: Math.max(1, saved.hours) });
      setSaved(null);
      return;
    }
    const target = saved;
    void markNow(target.employeeId, status).then((record) => {
      if (record) {
        setSaved((s) => (s && s.employeeId === target.employeeId ? { ...s, status, hours: 0, editing: false } : s));
      }
    });
  };
  const savedClose = () => setSaved(null);

  // Phone: ask → save → saved sheet that closes itself.
  const manualTimer = useRef<number | null>(null);
  const showManualDone = useCallback((done: Omit<ManualDone, "token">) => {
    const token = Date.now();
    setManualDone({ ...done, token });
    if (manualTimer.current) window.clearTimeout(manualTimer.current);
    manualTimer.current = window.setTimeout(() => {
      manualTimer.current = null;
      setManualDone((m) => (m && m.token === token ? null : m));
    }, MANUAL_DONE_MS);
  }, []);
  useEffect(
    () => () => {
      if (manualTimer.current) window.clearTimeout(manualTimer.current);
    },
    [],
  );
  const askStatus = (employeeId: number, status: "P" | "A") => {
    const row = rowsRef.current.get(employeeId);
    if (!row) return;
    setAction(null);
    setAsk({ employeeId, status, previous: recordStatus(row.record) });
  };
  const askConfirm = () => {
    if (!ask) return;
    const target = ask;
    setAsk(null);
    void markNow(target.employeeId, target.status).then((record) => {
      if (!record) return;
      beep("ok");
      say(target.status === "A" ? SPEECH.absent() : SPEECH.present());
      showManualDone({ employeeId: target.employeeId, status: target.status, hours: 0, previous: target.previous });
    });
  };
  const askCancel = () => setAsk(null);
  const manualDoneClose = () => {
    if (manualTimer.current) window.clearTimeout(manualTimer.current);
    manualTimer.current = null;
    setManualDone(null);
  };

  // Overtime pop-up (both layouts): Save writes at once.
  const openOvertime = useCallback((employeeId: number) => {
    const row = rowsRef.current.get(employeeId);
    if (!row) return;
    setAction(null);
    const current = draftFromRecord(row.record);
    setOtModal({ employeeId, hours: current.status === "O" ? current.ot_hours : 1 });
  }, []);
  const setOvertimeHours = (hours: number) =>
    setOtModal((m) => (m ? { ...m, hours: clampHours(hours) } : m));
  const cancelOvertime = () => setOtModal(null);
  const saveOvertime = () => {
    if (!otModal) return;
    const { employeeId, hours } = otModal;
    const row = rowsRef.current.get(employeeId);
    const previous = recordStatus(row?.record);
    setOtModal(null);
    void markNow(employeeId, "O", hours).then((record) => {
      if (!record) return;
      if (phone) {
        beep("ok");
        say(SPEECH.overtime(record.ot_hours));
        showManualDone({ employeeId, status: "O", hours: record.ot_hours, previous });
      } else {
        setSaved({ employeeId, status: "O", hours: record.ot_hours, previous, editing: false });
      }
    });
  };

  // ---- bulk (desktop, "Not marked" filter)

  const toggleSelected = (employeeId: number) =>
    setSelectedRaw((s) => {
      const next = new Set(s);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  const setSelected = (ids: number[], on: boolean) =>
    setSelectedRaw((s) => {
      const next = new Set(s);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const runBulk = async (request: Parameters<typeof bulkMarkPresent>[0], label: (n: number) => string) => {
    setBulkBusy(true);
    setError(null);
    try {
      const result = await bulkMarkPresent(request);
      applyRecords(result.records);
      setSelectedRaw(new Set());
      setPage(1);
      setBulkMessage({ text: label(result.marked.length), names: result.marked.map((m) => m.name) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark them. Try again.");
    } finally {
      setBulkBusy(false);
    }
  };
  const markSelected = () => {
    if (!data) return;
    const ids = scopeRows
      .filter((row) => selected.has(row.employee.id) && statusOf(row) === "N")
      .map((row) => row.employee.id);
    if (!ids.length) return;
    void runBulk(
      { date_bs: data.day.bs_date, branch_id: branchId, employee_ids: ids },
      (n) => `Marked ${n} as Present`,
    );
  };
  const markDepartment = () => {
    if (!data || departmentId === null) return;
    const name = department?.name ?? "department";
    void runBulk(
      { date_bs: data.day.bs_date, branch_id: branchId, department_id: departmentId },
      (n) => `Marked ${n} in ${name} as Present`,
    );
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
        employeeMonth: getEmployeeMonth,
      },
      currentDraft: (emp, todayRecord) =>
        draftFromRecord(todayRecord ?? rowsRef.current.get(emp.id)?.record ?? null),
      onMarked: (result) => {
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

  const personFor = (employeeId: number) => {
    const row = rowsRef.current.get(employeeId);
    return row ? { emp: row.employee, current: draftFromRecord(row.record) } : null;
  };

  return {
    canPickBranch,
    today,
    date,
    setDate,
    prevDay: () => shiftDay(-1),
    nextDay: () => shiftDay(1),
    goToday: () => {
      if (todayBs) setDate(todayBs);
      setCalendarOpen(false);
    },
    daysAgo,
    isPast,
    calendarOpen,
    setCalendarOpen,
    branchId,
    setBranch,
    departmentId,
    setDepartment,
    query,
    setQuery,
    statusFilter,
    setStatusFilter,
    photos,
    setPhotos,
    data,
    loading,
    error,
    clearError: () => setError(null),
    scopeRows,
    listRows,
    statusOf,
    draftOf,
    counts,
    scopeLabel,
    pending,
    page,
    setPage,
    paged,
    limit,
    showMore: () => setLimit((n) => n + MOBILE_BATCH),
    markNow,
    pickStatus,
    saved,
    savedEdit,
    savedChange,
    savedClose,
    askStatus,
    ask,
    askConfirm,
    askCancel,
    manualDone,
    manualDoneClose,
    otModal,
    openOvertime,
    setOvertimeHours,
    cancelOvertime,
    saveOvertime,
    action,
    openAction: (id) => setAction(id),
    closeAction: () => setAction(null),
    selected,
    toggleSelected,
    setSelected,
    bulkBusy,
    markSelected,
    markDepartment,
    bulkMessage,
    closeBulkMessage: () => setBulkMessage(null),
    scan: scanState.scan,
    scanCount: scanState.count,
    flow,
    openScanner: () => {
      unlockAudio();
      flow.open();
    },
    submitCode: (code) => flow.scan(code),
    openPayments: (employeeId) => {
      const p = personFor(employeeId);
      if (!p) return;
      setAction(null);
      flow.openHistoryFor(p.emp, p.current);
    },
    openAttendanceRecord: (employeeId) => {
      const p = personFor(employeeId);
      if (!p) return;
      setAction(null);
      flow.openRecordFor(p.emp, p.current, date.slice(0, 7));
    },
  };
}
