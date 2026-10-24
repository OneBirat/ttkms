/**
 * The scan loop as a small state machine with no React in it:
 *
 *   camera → (code) → found | already | missing
 *   found   → Present / Overtime → done  → 3 s → camera (last = summary)
 *   already → Salary / Advance → pay → history ⇄ pay → paid → 3 s → camera
 *   any sheet → Cancel · skip / Back → camera, nothing saved
 *
 * Timers, clock and the API are injected so the whole loop runs under
 * node:test with fake timers (see __tests__/scanFlow.test.ts); the React hook
 * (useScanFlow.ts) only subscribes to it.
 */

import { clampHours, formatAmount, type Draft } from "../helpers";
import type {
  AttendanceRecord,
  EmployeeMonth,
  EmployeeRef,
  LookupResponse,
  MarkStatus,
  MonthBalance,
  PaymentEntry,
  PaymentHistory,
  PaymentInput,
  PaymentResult,
  PaymentType,
  ScanRequest,
  ScanResponse,
} from "../types";

// ------------------------------------------------------------ state

/** Fields shared by the pay and history steps (history keeps the entered amount). */
export interface PayFields {
  type: PaymentType;
  /** Quick pick key: "500", "1000", …, "full", "custom"; null = nothing chosen yet. */
  pick: string | null;
  /** Custom amount as typed (digits only). */
  amount: string;
  balance: MonthBalance | null;
  history: PaymentEntry[] | null;
}

interface Person {
  emp: EmployeeRef;
  code: string;
  /** Today's status as the screen knows it (unsaved mark or server record). */
  current: Draft;
}

export type Scan =
  | { step: "camera"; last?: string; busy?: boolean }
  /** Desktop: a typed/USB code is being looked up; no overlay yet. */
  | { step: "lookup"; code: string }
  | (Person & {
      step: "found";
      mode: null | "ot";
      hours: number;
      busy: boolean;
      error: string | null;
    })
  | (Person & { step: "already"; busy: boolean; error: string | null })
  | (Person & PayFields & { step: "pay"; busy: boolean; error: string | null })
  /** `from` says where Back goes: "pay" (default), "already" (Payment record button) or "list" (phone ⋮ menu: close). */
  | (Person & PayFields & { step: "history"; from: HistoryOrigin; busy: boolean; error: string | null })
  /** Attendance record: one person's month, with a tappable day detail pop-up. */
  | (Person & {
      step: "attrec";
      from: "already" | "list";
      monthKey: string;
      month: EmployeeMonth | null;
      dayPop: number | null;
      busy: boolean;
      error: string | null;
    })
  | { step: "missing"; code: string }
  | { step: "done"; emp: EmployeeRef; token: number; summary: string; status: MarkStatus; hours: number }
  | {
      step: "paid";
      emp: EmployeeRef;
      token: number;
      summary: string;
      type: PaymentType;
      paid: PaymentResult;
      monthLabel: string;
      /** Paid in the month including this payment (the paid sheet's "Paid in {month}" tile). */
      monthPaid: number;
    };

export type ScanStep = Scan["step"];
export type HistoryOrigin = "pay" | "already" | "list";

export interface ScanFlowState {
  scan: Scan | null;
  /** People handled since the scanner was opened; reset on stop(). */
  count: number;
}

/** Steps that show a sheet over the camera / page. */
export const SHEET_STEPS: readonly ScanStep[] = ["found", "already", "pay", "history", "attrec", "missing", "done", "paid"];

/** Sheets opened from the phone list (⋮ menu) run without the camera; Back closes them. */
export function isListOrigin(scan: Scan | null | undefined): boolean {
  return !!scan && (scan.step === "history" || scan.step === "attrec") && scan.from === "list";
}

export function isSheetStep(step: ScanStep | undefined): boolean {
  return step !== undefined && SHEET_STEPS.includes(step);
}

// ------------------------------------------------------------ deps

export interface ScanFlowApi {
  lookup(code: string): Promise<LookupResponse>;
  mark(request: ScanRequest): Promise<ScanResponse>;
  balance(employeeId: number): Promise<MonthBalance>;
  history(employeeId: number): Promise<PaymentHistory>;
  pay(input: PaymentInput): Promise<PaymentResult>;
  employeeMonth(employeeId: number, monthKey: string): Promise<EmployeeMonth>;
}

/** Sounds are semantic events; the hook maps them to beep()/speak(). Every one is optional. */
export interface ScanFlowSounds {
  read?(): void;
  name?(employee: EmployeeRef): void;
  already?(employee: EmployeeRef): void;
  marked?(status: MarkStatus, hours: number): void;
  paid?(employee: EmployeeRef, type: PaymentType, amount: number): void;
  unknown?(): void;
  skip?(): void;
}

export interface ScanFlowDeps {
  api: ScanFlowApi;
  /** What the screen currently treats as today's status (unsaved mark or server record). */
  currentDraft(employee: EmployeeRef, today: AttendanceRecord | null): Draft;
  /** Called after a successful attendance save so the list behind the scanner updates. */
  onMarked?(result: ScanResponse): void;
  monthKey(): string;
  sounds?: ScanFlowSounds;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  /** Done / paid stay this long before the camera reopens (design: 7 s after a mark, 8 s after a payment). */
  autoReturnMs?: Partial<AutoReturn>;
  /** The same code read again within this window is ignored. */
  repeatIgnoreMs?: number;
}

export interface AutoReturn {
  done: number;
  paid: number;
}

export const AUTO_RETURN: AutoReturn = { done: 7000, paid: 8000 };
/** @deprecated kept for older tests; the done sheet uses AUTO_RETURN.done. */
export const AUTO_RETURN_MS = AUTO_RETURN.done;
export const REPEAT_IGNORE_MS = 3000;

// ------------------------------------------------------------ helpers

/** "2083-07" + (-1) -> "2083-06"; null for a malformed key. */
export function shiftMonthKey(key: string, delta: number): string | null {
  const m = /^(\d{4})-(\d{1,2})$/.exec(key);
  if (!m) return null;
  const index = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function isNotFound(err: unknown): boolean {
  return !!err && typeof err === "object" && "status" in err && (err as { status: unknown }).status === 404;
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** "✓ Kamala Bhandari · हाजिर" / "✓ Kamala Bhandari · हाजिर + 2 h" */
export function markSummary(employee: EmployeeRef, status: MarkStatus, hours: number): string {
  return `✓ ${employee.name} · ${status === "O" ? `हाजिर + ${hours} h` : "हाजिर"}`;
}

/** "✓ Kamala Bhandari · Advance Rs 1,500" */
export function paySummary(employee: EmployeeRef, type: PaymentType, amount: number): string {
  return `✓ ${employee.name} · ${type === "advance" ? "Advance" : "Salary"} Rs ${formatAmount(amount)}`;
}

/** Rupees the pay sheet is about to save: the quick pick or the custom amount. */
export function amountOf(fields: Pick<PayFields, "pick" | "amount" | "balance">): number {
  if (fields.pick === "full") return fields.balance?.due ?? 0;
  if (fields.pick === null || fields.pick === "custom") return Number.parseInt(fields.amount || "0", 10) || 0;
  return Number.parseInt(fields.pick, 10) || 0;
}

/** Validation text for the pay sheet; null when the amount can be saved. */
export function amountError(fields: Pick<PayFields, "pick" | "amount" | "balance">): string | null {
  const b = fields.balance;
  if (!b) return "Loading the balance…";
  const amount = amountOf(fields);
  if (fields.pick === null) return "Pick an amount.";
  if (!Number.isFinite(amount) || amount <= 0) return "Enter an amount above 0.";
  if (amount > b.due) return `More than the balance due for ${b.month_label} (Rs ${formatAmount(b.due)}).`;
  return null;
}

// ------------------------------------------------------------ the controller

export interface ScanFlow {
  getState(): ScanFlowState;
  subscribe(listener: () => void): () => void;
  /** Open the scanner (camera on a phone; on a desktop the first code opens it implicitly). */
  open(): void;
  /** Close the scanner: nothing saved, count reset, timers cleared. */
  stop(): void;
  /** A code from the camera, a USB scanner or the type-ID box. */
  scan(code: string): void;
  present(): void;
  otMode(on: boolean): void;
  otBack(): void;
  setHours(hours: number): void;
  saveOvertime(): void;
  changeAttendance(): void;
  choosePayment(type: PaymentType): void;
  payBack(): void;
  setPick(key: string): void;
  setAmount(text: string): void;
  savePayment(): void;
  openHistory(): void;
  historyBack(): void;
  /** From the already-marked sheet: this month's payments (Back returns there). */
  openPaymentRecord(): void;
  /** From the already-marked sheet: the attendance record (Back returns there). */
  openAttendanceRecord(): void;
  /** Phone ⋮ menu: open the history / record for a person without a scan; Back closes the sheet. */
  openHistoryFor(employee: EmployeeRef, current: Draft): void;
  openRecordFor(employee: EmployeeRef, current: Draft, monthKey: string): void;
  recordMonth(delta: number): void;
  recordDay(day: number | null): void;
  recordBack(): void;
  /** Leave the current person without saving; back to the camera. */
  skip(): void;
  /** From done / paid (or missing): straight back to the camera. */
  scanNext(): void;
  /** Escape / hardware Back: history → pay, OT picker → choice, other sheets → skip, done/paid → next, camera → stop. Returns whether the scanner is still open. */
  back(): boolean;
  /** Stop timers and notifications (unmount). `resume()` undoes it (React StrictMode replays effects). */
  dispose(): void;
  resume(): void;
}

export function createScanFlow(deps: ScanFlowDeps): ScanFlow {
  const now = deps.now ?? (() => Date.now());
  const schedule = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const unschedule = deps.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const autoReturnMs: AutoReturn = { ...AUTO_RETURN, ...deps.autoReturnMs };
  const repeatIgnoreMs = deps.repeatIgnoreMs ?? REPEAT_IGNORE_MS;
  const sounds = deps.sounds ?? {};

  let state: ScanFlowState = { scan: null, count: 0 };
  const listeners = new Set<() => void>();
  let disposed = false;
  let timer: unknown = null;
  let lastCode = "";
  let lastAt = Number.NEGATIVE_INFINITY;
  let lookupSeq = 0;
  let loadSeq = 0;

  const emit = () => {
    for (const fn of listeners) {
      try {
        fn();
      } catch {
        // A listener must never break the flow.
      }
    }
  };
  const set = (patch: Partial<ScanFlowState>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    emit();
  };
  const setScan = (scan: Scan | null) => set({ scan });
  const scanIs = <S extends ScanStep>(step: S): Extract<Scan, { step: S }> | null =>
    state.scan && state.scan.step === step ? (state.scan as Extract<Scan, { step: S }>) : null;
  const patchScan = <S extends ScanStep>(step: S, patch: Partial<Extract<Scan, { step: S }>>) => {
    const s = scanIs(step);
    if (s) setScan({ ...s, ...patch } as Scan);
  };

  const clearTimer = () => {
    if (timer !== null) unschedule(timer);
    timer = null;
  };
  const scheduleReturn = (token: number, summary: string, ms: number) => {
    clearTimer();
    timer = schedule(() => {
      timer = null;
      const s = state.scan;
      if (s && (s.step === "done" || s.step === "paid") && s.token === token) {
        setScan({ step: "camera", last: summary });
      }
    }, ms);
  };
  const toCamera = (last?: string) => {
    clearTimer();
    setScan(last ? { step: "camera", last } : { step: "camera" });
  };
  const safe = (fn?: () => void) => {
    try {
      fn?.();
    } catch {
      // Sounds are a courtesy.
    }
  };

  // ---- loading the month figures for the pay / history sheets

  const loadPayData = (employeeId: number) => {
    const seq = ++loadSeq;
    const apply = (patch: Partial<PayFields>) => {
      if (seq !== loadSeq || disposed) return;
      const s = state.scan;
      if (s && (s.step === "pay" || s.step === "history") && s.emp.id === employeeId) {
        setScan({ ...s, ...patch });
      }
    };
    deps.api
      .balance(employeeId)
      .then((balance) => apply({ balance }))
      .catch((err: unknown) => {
        const s = state.scan;
        if (seq === loadSeq && s && (s.step === "pay" || s.step === "history")) {
          setScan({ ...s, error: messageOf(err, "Could not load the balance.") });
        }
      });
    deps.api
      .history(employeeId)
      .then((h) => apply({ history: h.payments, balance: { ...balanceFromHistory(h) } }))
      .catch(() => apply({ history: [] }));
  };

  const loadRecord = (employeeId: number, monthKey: string) => {
    const seq = ++loadSeq;
    deps.api
      .employeeMonth(employeeId, monthKey)
      .then((month) => {
        if (seq !== loadSeq || disposed) return;
        const s = scanIs("attrec");
        if (s && s.emp.id === employeeId && s.monthKey === monthKey) setScan({ ...s, month, busy: false, error: null });
      })
      .catch((err: unknown) => {
        if (seq !== loadSeq || disposed) return;
        const s = scanIs("attrec");
        if (s && s.emp.id === employeeId) setScan({ ...s, busy: false, error: messageOf(err, "Could not load the month.") });
      });
  };

  const balanceFromHistory = (h: PaymentHistory): MonthBalance => ({
    employee_id: h.employee_id,
    month_key: h.month_key,
    month_label: h.month_label,
    net: h.totals.net,
    paid: h.totals.paid,
    due: h.totals.due,
  });

  // ---- actions

  const open = () => {
    if (!state.scan) setScan({ step: "camera" });
  };

  const stop = () => {
    clearTimer();
    lookupSeq += 1;
    loadSeq += 1;
    set({ scan: null, count: 0 });
  };

  const scan = (raw: string) => {
    const code = raw.trim();
    if (!code || disposed) return;
    const s = state.scan;
    // Decodes while a sheet is open are ignored; done/paid are interrupted by a new card.
    if (s && !["camera", "lookup", "done", "paid"].includes(s.step)) return;
    const t = now();
    if (code === lastCode && t - lastAt < repeatIgnoreMs) return;
    lastCode = code;
    lastAt = t;
    clearTimer();
    safe(sounds.read);
    const seq = ++lookupSeq;
    if (s?.step === "camera") setScan({ ...s, busy: true });
    else setScan({ step: "lookup", code });
    const fromCamera = s?.step === "camera" ? s.last : undefined;
    deps.api
      .lookup(code)
      .then((found) => {
        if (seq !== lookupSeq || disposed) return;
        const current = deps.currentDraft(found.employee, found.today);
        if (current.status !== null) {
          setScan({ step: "already", emp: found.employee, code, current, busy: false, error: null });
          safe(() => sounds.already?.(found.employee));
        } else {
          setScan({ step: "found", emp: found.employee, code, current, mode: null, hours: 1, busy: false, error: null });
          safe(() => sounds.name?.(found.employee));
        }
      })
      .catch((err: unknown) => {
        if (seq !== lookupSeq || disposed) return;
        if (isNotFound(err)) {
          setScan({ step: "missing", code });
          safe(sounds.unknown);
        } else {
          setScan({ step: "camera", last: `${messageOf(err, "Lookup failed")} · ${fromCamera ?? code}` });
        }
      });
  };

  const commit = (action: "present" | "overtime", hours: number) => {
    const s = scanIs("found");
    if (!s || s.busy) return;
    setScan({ ...s, busy: true, error: null });
    const emp = s.emp;
    deps.api
      .mark({ code: s.code, action, ot_hours: action === "overtime" ? hours : 0 })
      .then((result) => {
        if (disposed) return;
        try {
          deps.onMarked?.(result);
        } catch {
          // The list behind the scanner is best effort.
        }
        const cur = scanIs("found");
        if (!cur || cur.emp.id !== emp.id) return; // skipped or stopped meanwhile
        const token = now();
        const summary = markSummary(result.employee, result.record.status, result.record.ot_hours);
        set({
          scan: { step: "done", emp: result.employee, token, summary, status: result.record.status, hours: result.record.ot_hours },
          count: state.count + 1,
        });
        safe(() => sounds.marked?.(result.record.status, result.record.ot_hours));
        scheduleReturn(token, summary, autoReturnMs.done);
      })
      .catch((err: unknown) => {
        if (disposed) return;
        const cur = scanIs("found");
        if (cur && cur.emp.id === emp.id) {
          setScan({ ...cur, busy: false, error: messageOf(err, "Could not save. Try again.") });
        }
      });
  };

  const savePayment = () => {
    const s = scanIs("pay");
    if (!s || s.busy) return;
    const error = amountError(s);
    if (error || !s.balance) {
      setScan({ ...s, error: error ?? "Loading the balance…" });
      return;
    }
    const amount = amountOf(s);
    const emp = s.emp;
    const type = s.type;
    const monthLabel = s.balance.month_label;
    const monthPaid = s.balance.paid + amount;
    setScan({ ...s, busy: true, error: null });
    deps.api
      .pay({ employee_id: emp.id, month_key: deps.monthKey(), type, amount, method: "cash", source: "scan" })
      .then((paid) => {
        if (disposed) return;
        const cur = scanIs("pay");
        if (!cur || cur.emp.id !== emp.id) return;
        const token = now();
        const summary = paySummary(emp, type, amount);
        set({ scan: { step: "paid", emp, token, summary, type, paid, monthLabel, monthPaid }, count: state.count + 1 });
        safe(() => sounds.paid?.(emp, type, amount));
        scheduleReturn(token, summary, autoReturnMs.paid);
      })
      .catch((err: unknown) => {
        if (disposed) return;
        const cur = scanIs("pay");
        if (cur && cur.emp.id === emp.id) {
          setScan({ ...cur, busy: false, error: messageOf(err, "Could not record the payment.") });
        }
      });
  };

  const skip = () => {
    const s = state.scan;
    if (!s) return;
    if ((s.step === "history" || s.step === "attrec") && s.from === "list") {
      stop();
      return;
    }
    if (s.step === "missing") toCamera();
    else if ("emp" in s) toCamera(`Skipped ${s.emp.name}`);
    else return;
    lookupSeq += 1;
    loadSeq += 1;
    safe(sounds.skip);
  };

  const scanNext = () => {
    const s = state.scan;
    if (!s) return;
    if (s.step === "done" || s.step === "paid") toCamera(s.summary);
    else if (s.step === "missing") toCamera();
  };

  const back = (): boolean => {
    const s = state.scan;
    if (!s) return false;
    switch (s.step) {
      case "camera":
      case "lookup":
        stop();
        return false;
      case "history":
        historyBack();
        return state.scan !== null;
      case "attrec":
        if (s.dayPop !== null) setScan({ ...s, dayPop: null });
        else recordBack();
        return state.scan !== null;
      case "found":
        if (s.mode === "ot") setScan({ ...s, mode: null });
        else skip();
        return true;
      case "done":
      case "paid":
        scanNext();
        return true;
      default:
        skip();
        return true;
    }
  };

  const emptyPay = (emp: EmployeeRef, code: string, current: Draft, type: PaymentType) => ({
    emp,
    code,
    current,
    type,
    pick: null as string | null,
    amount: "",
    balance: null as MonthBalance | null,
    history: null as PaymentEntry[] | null,
    busy: false,
    error: null as string | null,
  });

  const openRecord = (emp: EmployeeRef, code: string, current: Draft, monthKey: string, from: "already" | "list") => {
    setScan({ step: "attrec", emp, code, current, from, monthKey, month: null, dayPop: null, busy: true, error: null });
    loadRecord(emp.id, monthKey);
  };

  function historyBack(): void {
    const s = scanIs("history");
    if (!s) return;
    if (s.from === "list") stop();
    else if (s.from === "already") setScan({ step: "already", emp: s.emp, code: s.code, current: s.current, busy: false, error: null });
    else {
      const { from: _from, ...rest } = s;
      void _from;
      setScan({ ...rest, step: "pay" });
    }
  }

  function recordBack(): void {
    const s = scanIs("attrec");
    if (!s) return;
    if (s.from === "list") stop();
    else setScan({ step: "already", emp: s.emp, code: s.code, current: s.current, busy: false, error: null });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open,
    stop,
    scan,
    present: () => commit("present", 0),
    otMode: (on) => {
      const s = scanIs("found");
      if (s) setScan({ ...s, mode: on ? "ot" : null });
    },
    otBack: () => patchScan("found", { mode: null }),
    setHours: (hours) => patchScan("found", { hours: clampHours(hours) }),
    saveOvertime: () => {
      const s = scanIs("found");
      if (s) commit("overtime", clampHours(s.hours));
    },
    changeAttendance: () => {
      const s = scanIs("already");
      if (s) {
        setScan({
          step: "found",
          emp: s.emp,
          code: s.code,
          current: s.current,
          mode: null,
          hours: s.current.status === "O" ? s.current.ot_hours : 1,
          busy: false,
          error: null,
        });
      }
    },
    choosePayment: (type) => {
      const s = scanIs("already");
      if (!s) return;
      setScan({
        step: "pay",
        emp: s.emp,
        code: s.code,
        current: s.current,
        type,
        pick: type === "salary" ? "full" : null,
        amount: "",
        balance: null,
        history: null,
        busy: false,
        error: null,
      });
      loadPayData(s.emp.id);
    },
    payBack: () => {
      const s = scanIs("pay");
      if (s) setScan({ step: "already", emp: s.emp, code: s.code, current: s.current, busy: false, error: null });
    },
    setPick: (key) => {
      const s = scanIs("pay");
      if (s) setScan({ ...s, pick: key, amount: key === "custom" ? "" : s.amount, error: null });
    },
    setAmount: (text) => {
      const s = scanIs("pay");
      if (s) setScan({ ...s, amount: text.replace(/[^0-9]/g, "").slice(0, 9), error: null });
    },
    savePayment,
    openHistory: () => {
      const s = scanIs("pay");
      if (!s) return;
      setScan({ ...s, step: "history", from: "pay", error: null });
      loadPayData(s.emp.id); // a payment saved in this session shows at the top
    },
    historyBack,
    openPaymentRecord: () => {
      const s = scanIs("already");
      if (!s) return;
      setScan({ ...emptyPay(s.emp, s.code, s.current, "advance"), step: "history", from: "already" });
      loadPayData(s.emp.id);
    },
    openAttendanceRecord: () => {
      const s = scanIs("already");
      if (!s) return;
      openRecord(s.emp, s.code, s.current, deps.monthKey(), "already");
    },
    openHistoryFor: (employee, current) => {
      clearTimer();
      setScan({ ...emptyPay(employee, employee.code, current, "advance"), step: "history", from: "list" });
      loadPayData(employee.id);
    },
    openRecordFor: (employee, current, monthKey) => {
      clearTimer();
      openRecord(employee, employee.code, current, monthKey, "list");
    },
    recordMonth: (delta) => {
      const s = scanIs("attrec");
      if (!s) return;
      const next = shiftMonthKey(s.monthKey, delta);
      if (!next || next > deps.monthKey()) return; // the future is locked
      setScan({ ...s, monthKey: next, month: null, dayPop: null, busy: true, error: null });
      loadRecord(s.emp.id, next);
    },
    recordDay: (day) => {
      const s = scanIs("attrec");
      if (s) setScan({ ...s, dayPop: day });
    },
    recordBack,
    skip,
    scanNext,
    back,
    dispose: () => {
      disposed = true;
      clearTimer();
    },
    resume: () => {
      disposed = false;
    },
  };
}
