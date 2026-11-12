"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActiveBranch } from "@/lib/branchContext";
import { useSession } from "@/lib/session";
import { listPaymentModes } from "@/app/people/api";
import type { PaymentMode } from "@/app/people/types";
import {
  bulkMarkPresent,
  clearMark,
  getDay,
  getEmployeeMonth,
  getMarkedDays,
  getMonthBalance,
  getPaymentHistoryFor,
  getSalaryDues,
  getSalaryMonthKey,
  paySalaryFromScan,
  getToday,
  lookupCode,
  markOne,
  previewOverride,
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
import { canBulk, isLockedError, reasonError, rowAccess, type RowAccess } from "./lock";
import type { Scan, ScanFlow } from "./scan/scanFlow";
import { useScanFlow } from "./scan/useScanFlow";
import { SPEECH, beep as rawBeep, speak as rawSpeak, unlockAudio } from "./speak";
import type {
  AttendanceRecord,
  BulkMarkRequest,
  CellStatus,
  DayAttendance,
  DayLock,
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

/** "Clear mark?" before the record is removed (both layouts). */
export interface ClearConfirm {
  employeeId: number;
  previous: CellStatus;
}

/**
 * The super admin's confirm sheet for a change on a past day: old → new, the required reason.
 * One person (mark / clear) or a bulk "Mark as Present".
 */
export interface OverrideAsk {
  kind: "mark" | "clear" | "bulk";
  /** null for bulk. */
  employeeId: number | null;
  /** The new mark; null = clear it. */
  status: MarkStatus | null;
  hours: number;
  previous: CellStatus;
  previousHours: number;
  /** Bulk only. */
  bulk?: { request: BulkMarkRequest; count: number; scope: string; done: (n: number) => string };
  reason: string;
  busy: boolean;
  error: string | null;
  /** Which sheet this is (a late answer for an earlier sheet is dropped). */
  token: number;
  /** The payroll check is still running ("Change as super admin" waits for it). */
  checking: boolean;
  /** "{Month} salary is already paid. This changes the net pay by Rs X; the due will become Rs Y." */
  warning: string | null;
}

export interface BulkMessage {
  text: string;
  names: string[];
}

export interface MarkState {
  // who
  /** The ONE active branch (lib/branch.tsx) the day list is for; switched in the shell only. */
  branchName: string;
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
  /** BS dates of the shown month and the one before with any mark in the branch (date picker dots). */
  markedDays: string[];
  branchId: number;
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
  // the lock (lock.ts): the server decides, the screens only show it
  lock: DayLock | null;
  /** "edit" = the row's buttons work; "locked" = they are disabled. */
  accessOf: (row: MarkRow) => RowAccess;
  /** New marks in bulk are possible (today; a past day for the super admin). */
  canBulk: boolean;
  // the super admin's confirm sheet on a past day (every change needs a reason)
  override: OverrideAsk | null;
  setOverrideReason: (reason: string) => void;
  overrideConfirm: () => void;
  overrideCancel: () => void;
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
  // clear mark (phone ⋮ sheet, desktop saved pop-up), with a confirm
  clearAsk: ClearConfirm | null;
  askClear: (employeeId: number) => void;
  clearConfirm: () => void;
  clearCancel: () => void;
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
  /** salary_advances: the scan flow's Salary / Advance steps and "View payments". */
  canPay: boolean;
  /** Active payment modes for "Paid by" (Cash | Other ▾); loaded only with canPay. */
  paymentModes: PaymentMode[];
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
  const { can } = useSession();
  const { branch: activeBranch } = useActiveBranch();
  // The shell's active branch; switching it remounts the page (AppShell), so this never changes here.
  const branchId = activeBranch?.id ?? 0;
  const branchName = activeBranch?.name ?? "";
  const canPay = can("salary_advances");
  const canPayRef = useRef(canPay);
  canPayRef.current = canPay;
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>([]);
  useEffect(() => {
    if (!canPay) return;
    let cancelled = false;
    listPaymentModes()
      .then((modes) => {
        if (!cancelled) setPaymentModes(modes);
      })
      .catch(() => {
        // Cash still works without the list (the picker then offers Cash only).
      });
    return () => {
      cancelled = true;
    };
  }, [canPay]);

  const [today, setToday] = useState<TodayRef | null>(null);
  const [date, setDateRaw] = useState("");
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
  const [clearAsk, setClearAsk] = useState<ClearConfirm | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [override, setOverride] = useState<OverrideAsk | null>(null);
  const overrideSeq = useRef(0);

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
    getDay(date)
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
  }, [date, branchId, reloadKey]);

  // Date-picker dots: days with any mark, for the date's month and the month before.
  const [markedDays, setMarkedDays] = useState<string[]>([]);
  const monthOfDate = isValidBs(date) ? date.slice(0, 7) : "";
  useEffect(() => {
    if (!monthOfDate) return;
    let cancelled = false;
    const [y, m] = monthOfDate.split("-").map(Number);
    const previous = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    Promise.all([monthOfDate, previous].map((key) => getMarkedDays(key).catch(() => [] as string[])))
      .then((lists) => {
        if (!cancelled) setMarkedDays(lists.flat());
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [monthOfDate, branchId]);

  const rowsById = useMemo(() => {
    const map = new Map<number, MarkRow>();
    for (const row of data?.rows ?? []) map.set(row.employee.id, row);
    return map;
  }, [data]);
  const rowsRef = useRef(rowsById);
  rowsRef.current = rowsById;

  const dataRef = useRef(data);
  dataRef.current = data;
  const lock = data?.lock ?? null;
  const lockRef = useRef(lock);
  lockRef.current = lock;
  const accessOf = useCallback((row: MarkRow): RowAccess => rowAccess(lock, row.record), [lock]);
  /** The row's access right now (callbacks; the 24 hours may have run out since the render). */
  const accessNow = useCallback((employeeId: number): RowAccess => {
    const row = rowsRef.current.get(employeeId);
    return row ? rowAccess(lockRef.current, row.record) : "locked";
  }, []);
  /** A refused save: say why; when the mark turned out to be locked, load the day again. */
  const failed = useCallback((err: unknown, fallback: string) => {
    setError(err instanceof Error ? err.message : fallback);
    if (isLockedError(err)) setReloadKey((k) => k + 1);
  }, []);

  /**
   * On a past day the super admin's changes go through the confirm sheet (old → new + reason)
   * instead of saving at once. True when the row is in override mode - the caller then stops.
   */
  /**
   * Open the confirm sheet and ask what the change does to that month's pay: when the month
   * is already paid, the sheet warns (it never blocks). The check failing shows no warning.
   */
  const openOverride = useCallback(
    (ask: Pick<OverrideAsk, "kind" | "employeeId" | "status" | "hours" | "previous" | "previousHours" | "bulk">, ids: number[]) => {
      const token = ++overrideSeq.current;
      const dateBs = dataRef.current?.day.bs_date ?? "";
      const mine = (o: OverrideAsk | null, patch: Partial<OverrideAsk>) => (o && o.token === token ? { ...o, ...patch } : o);
      setOverride({ ...ask, reason: "", busy: false, error: null, token, checking: ids.length > 0, warning: null });
      if (!ids.length || !dateBs) return;
      previewOverride(
        dateBs,
        ids.map((id) => ({ employee_id: id, status: ask.status, ot_hours: ask.status === "O" ? ask.hours : 0 })),
      )
        .then((preview) => setOverride((o) => mine(o, { checking: false, warning: preview.warning })))
        .catch(() => setOverride((o) => mine(o, { checking: false })));
    },
    [],
  );

  const beginOverride = useCallback((employeeId: number, status: MarkStatus | null, hours = 0): boolean => {
    if (accessNow(employeeId) !== "override") return false;
    const record = rowsRef.current.get(employeeId)?.record ?? null;
    const previous = recordStatus(record);
    const previousHours = record?.ot_hours ?? 0;
    setAction(null);
    setAsk(null);
    setSaved(null);
    setOtModal(null);
    setClearAsk(null);
    if (status === null ? !record : previous === status && previousHours === hours) return true; // nothing to change
    openOverride(
      { kind: status === null ? "clear" : "mark", employeeId, status, hours, previous, previousHours },
      [employeeId],
    );
    return true;
  }, [accessNow, openOverride]);

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

  const department = data?.departments.find((d) => d.id === departmentId);
  const filterWord = { "": "staff", N: "not marked", P: "present", O: "overtime", A: "absent", W: "weekly off" }[statusFilter];
  const scopeLabel = phone
    ? `${department ? department.name : "All departments"} · ${listRows.length} ${filterWord}`
    : `${branchName || "…"}, ${department ? department.name : "all departments"} · ${scopeRows.length} staff`;

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
        setMarkedDays((days) => (days.includes(result.record.date_bs) ? days : [...days, result.record.date_bs]));
        setSelectedRaw((s) => {
          if (!s.has(employeeId)) return s;
          const next = new Set(s);
          next.delete(employeeId);
          return next;
        });
        return result.record;
      } catch (err) {
        failed(err, "Could not save. Try again.");
        return null;
      } finally {
        setPending((p) => {
          const next = new Set(p);
          next.delete(employeeId);
          return next;
        });
      }
    },
    [data, applyRecords, failed],
  );

  // Desktop: click → save → "Saved as" pop-up.
  const pickStatus = useCallback(
    (employeeId: number, status: "P" | "A") => {
      const row = rowsRef.current.get(employeeId);
      if (!row || accessNow(employeeId) === "locked") return;
      if (beginOverride(employeeId, status)) return;
      const previous = recordStatus(row.record);
      void markNow(employeeId, status).then((record) => {
        if (record) setSaved({ employeeId, status, hours: 0, previous, editing: false });
      });
    },
    [markNow, accessNow, beginOverride],
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
    if (beginOverride(target.employeeId, status)) return;
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
    if (!row || accessNow(employeeId) === "locked") return;
    if (beginOverride(employeeId, status)) return;
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
    if (!row || accessNow(employeeId) === "locked") return;
    setAction(null);
    const current = draftFromRecord(row.record);
    setOtModal({ employeeId, hours: current.status === "O" ? current.ot_hours : 1 });
  }, [accessNow]);
  const setOvertimeHours = (hours: number) =>
    setOtModal((m) => (m ? { ...m, hours: clampHours(hours) } : m));
  const cancelOvertime = () => setOtModal(null);
  const saveOvertime = () => {
    if (!otModal) return;
    const { employeeId, hours } = otModal;
    const row = rowsRef.current.get(employeeId);
    const previous = recordStatus(row?.record);
    if (beginOverride(employeeId, "O", hours)) return;
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

  // ---- clear mark: back to not marked (weekly off on a Saturday)

  const askClear = (employeeId: number) => {
    const row = rowsRef.current.get(employeeId);
    if (!row || !row.record || accessNow(employeeId) === "locked") return;
    if (beginOverride(employeeId, null)) return;
    setAction(null);
    setSaved(null);
    setClearAsk({ employeeId, previous: recordStatus(row.record) });
  };
  const clearConfirm = () => {
    if (!clearAsk || !data) return;
    const { employeeId } = clearAsk;
    const dateBs = data.day.bs_date;
    setClearAsk(null);
    setPending((p) => new Set(p).add(employeeId));
    setError(null);
    clearMark(employeeId, dateBs)
      .then(() => {
        setData((current) =>
          current && current.day.bs_date === dateBs
            ? { ...current, rows: current.rows.map((row) => (row.employee.id === employeeId ? { ...row, record: null } : row)) }
            : current,
        );
      })
      .catch((err: unknown) => failed(err, "Could not clear the mark. Try again."))
      .finally(() =>
        setPending((p) => {
          const next = new Set(p);
          next.delete(employeeId);
          return next;
        }),
      );
  };
  const clearCancel = () => setClearAsk(null);

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

  const runBulk = async (request: BulkMarkRequest, label: (n: number) => string, ids: number[] = [], scope = "") => {
    if (lock?.mode === "override") {
      // A past day, the super admin: the same confirm sheet, for everyone picked at once.
      openOverride(
        {
          kind: "bulk",
          employeeId: null,
          status: "P",
          hours: 0,
          previous: "N",
          previousHours: 0,
          bulk: { request, count: ids.length, scope, done: label },
        },
        ids,
      );
      return;
    }
    setBulkBusy(true);
    setError(null);
    try {
      const result = await bulkMarkPresent(request);
      applyRecords(result.records);
      setSelectedRaw(new Set());
      setPage(1);
      setBulkMessage({ text: label(result.marked.length), names: result.marked.map((m) => m.name) });
    } catch (err) {
      failed(err, "Could not mark them. Try again.");
    } finally {
      setBulkBusy(false);
    }
  };
  const markSelected = () => {
    if (!data || !canBulk(lock)) return;
    const ids = scopeRows
      .filter((row) => selected.has(row.employee.id) && statusOf(row) === "N")
      .map((row) => row.employee.id);
    if (!ids.length) return;
    void runBulk(
      { date_bs: data.day.bs_date, branch_id: branchId, employee_ids: ids },
      (n) => `Marked ${n} as Present`,
      ids,
      `${ids.length} selected`,
    );
  };
  const markDepartment = () => {
    if (!data || departmentId === null || !canBulk(lock)) return;
    const name = department?.name ?? "department";
    void runBulk(
      { date_bs: data.day.bs_date, branch_id: branchId, department_id: departmentId },
      (n) => `Marked ${n} in ${name} as Present`,
      scopeRows.filter((row) => statusOf(row) === "N").map((row) => row.employee.id),
      `${counts.not_marked} not marked in ${name}`,
    );
  };

  // ---- the super admin's confirm sheet (a past day): one save with the reason

  const setOverrideReason = (reason: string) => setOverride((o) => (o ? { ...o, reason, error: null } : o));
  const overrideCancel = () => setOverride((o) => (o?.busy ? o : null));
  const overrideConfirm = () => {
    const o = override;
    if (!o || o.busy || o.checking || !data) return;
    const problem = reasonError(o.reason);
    if (problem) {
      setOverride({ ...o, error: problem });
      return;
    }
    const reason = o.reason.trim();
    const dateBs = data.day.bs_date;
    setOverride({ ...o, busy: true, error: null });
    setError(null);
    const save = async () => {
      if (o.kind === "bulk" && o.bulk) {
        const result = await bulkMarkPresent({ ...o.bulk.request, reason });
        applyRecords(result.records);
        setSelectedRaw(new Set());
        setPage(1);
        setBulkMessage({ text: o.bulk.done(result.marked.length), names: result.marked.map((m) => m.name) });
        if (result.records.length) setMarkedDays((days) => (days.includes(dateBs) ? days : [...days, dateBs]));
        return;
      }
      const employeeId = o.employeeId!;
      if (o.status === null) {
        await clearMark(employeeId, dateBs, reason);
        setData((current) =>
          current && current.day.bs_date === dateBs
            ? { ...current, rows: current.rows.map((row) => (row.employee.id === employeeId ? { ...row, record: null } : row)) }
            : current,
        );
        return;
      }
      const result = await markOne({
        date_bs: dateBs,
        employee_id: employeeId,
        status: o.status,
        ot_hours: o.status === "O" ? clampHours(o.hours) : 0,
        reason,
      });
      applyRecords([result.record]);
      setMarkedDays((days) => (days.includes(dateBs) ? days : [...days, dateBs]));
      const done = { employeeId, status: o.status, hours: result.record.ot_hours, previous: o.previous };
      if (phone) showManualDone(done);
      else setSaved({ ...done, editing: false });
    };
    save()
      .then(() => setOverride(null))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Could not save. Try again.";
        if (isLockedError(err)) {
          setOverride(null);
          failed(err, message);
        } else {
          setOverride((cur) => (cur ? { ...cur, busy: false, error: message } : cur));
        }
      });
  };

  // ---- scan flow (scan/scanFlow.ts)

  const currentMonthKey = today?.bs_date.slice(0, 7) ?? "";
  const { state: scanState, flow } = useScanFlow(
    {
      api: {
        lookup: lookupCode,
        mark: scanMark,
        // Advance: the running month. Salary: payroll's settlement month (previous month while it is still due).
        balance: async (id, kind) => getMonthBalance(id, kind === "salary" ? await getSalaryMonthKey(id) : currentMonthKey),
        history: (id, monthKey) => getPaymentHistoryFor(id, monthKey),
        pay: recordPayment,
        // Salary: one amount over the salary due, oldest month first (payroll /salary-payments).
        salaryDues: getSalaryDues,
        paySalary: paySalaryFromScan,
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
      canPay: () => canPayRef.current,
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
    branchName,
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
    markedDays,
    branchId,
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
    lock,
    accessOf,
    canBulk: canBulk(lock),
    override,
    setOverrideReason,
    overrideConfirm,
    overrideCancel,
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
    clearAsk,
    askClear,
    clearConfirm,
    clearCancel,
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
    canPay,
    paymentModes,
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
