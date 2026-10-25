/**
 * The scan loop under fake timers: scan → confirm → done → camera, cancel /
 * skip / back from every sheet, the payment history, and the API-error paths.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { amountError, amountOf, createScanFlow, shiftMonthKey, type Scan, type ScanFlowApi } from "../scan/scanFlow";

/** The tests use a short, equal auto-return for done and paid. */
const AUTO_RETURN_MS = 3000;
import type { EmployeeRef, PaymentRecord, PaymentHistory, ScanResponse } from "../types";

// ---- fakes

class FakeClock {
  now = 1_000_000;
  private queue: { at: number; fn: () => void; id: number }[] = [];
  private seq = 0;
  setTimeout = (fn: () => void, ms: number) => {
    const id = ++this.seq;
    this.queue.push({ at: this.now + ms, fn, id });
    return id;
  };
  clearTimeout = (handle: unknown) => {
    this.queue = this.queue.filter((t) => t.id !== handle);
  };
  /** Advance the clock, firing due timers in order. */
  async advance(ms: number) {
    const target = this.now + ms;
    for (;;) {
      const due = this.queue.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.queue = this.queue.filter((t) => t.id !== due.id);
      this.now = due.at;
      due.fn();
      await flush();
    }
    this.now = target;
  }
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const kamala: EmployeeRef = {
  id: 4, code: "E-004", name: "Kamala Bhandari", name_ne: "कमला भण्डारी",
  branch_id: 1, branch_name: "Main branch", department_id: 1, department_name: "Store",
};
const laxmi: EmployeeRef = { ...kamala, id: 11, code: "E-011", name: "Laxmi Karki", name_ne: null };

function notFound(): Error & { status: number } {
  return Object.assign(new Error("No employee"), { status: 404 });
}

function setup(
  options: { markFails?: boolean; marked?: Set<number>; canPay?: boolean; ashojDue?: boolean; balanceFails?: Error; settle?: boolean } = {},
) {
  const clock = new FakeClock();
  const calls: string[] = [];
  const marked = options.marked ?? new Set<number>();
  const record = (id: number, dateBs: string, date: string, kind: PaymentRecord["kind"], amount: number, recordedAt: string): PaymentRecord => ({
    payment_id: id, receipt_no: `${kind === "advance" ? "ADV" : "SAL"}-${String(id).padStart(4, "0")}`, employee_id: 4,
    for_year: 2083, for_month: 7, kind, amount, payment_mode_id: 1, payment_mode: "Cash", date, date_bs: dateBs, note: "Cash",
    source: "account", recorded_at: recordedAt,
  });
  let payments: PaymentRecord[] = [
    record(1, "2083-07-04", "2026-10-21", "advance", 2000, "2026-10-21T10:00:00Z"),
    record(2, "2083-07-11", "2026-10-28", "advance", 3000, "2026-10-28T10:00:00Z"),
  ];
  let paid = 5000;
  const earned = 20000;
  const history = (): PaymentHistory => ({
    employee_id: 4, month_key: "2083-07", month_label: "Kartik 2083",
    payments: [...payments].sort((a, b) => (b.recorded_at < a.recorded_at ? -1 : 1)),
    totals: { earned, paid, due: earned - paid },
  });
  const api: ScanFlowApi = {
    async lookup(code) {
      calls.push(`lookup ${code}`);
      const c = code.toUpperCase();
      if (c.includes("004") || c === "4") return { code, employee: kamala, today: null };
      if (c.includes("011")) return { code, employee: laxmi, today: null };
      throw notFound();
    },
    async mark(req) {
      calls.push(`mark ${req.code} ${req.action} ${req.ot_hours}`);
      if (options.markFails) throw new Error("Server busy");
      const status = req.action === "overtime" ? "O" : "P";
      const result: ScanResponse = {
        employee: req.employee_id === laxmi.id ? laxmi : kamala,
        record: { employee_id: 4, date_bs: "2083-07-07", date_ad: "2026-10-24", status, ot_hours: req.ot_hours, note: "", marked_by: "admin", marked_via: "scan", updated_at: "" },
      };
      marked.add(result.employee.id);
      return result;
    },
    async balance(_id, kind) {
      calls.push(`balance ${kind}`);
      if (options.balanceFails) throw options.balanceFails;
      // Salary: payroll's settlement month (Ashoj while it is still due); advance: the running month.
      if (kind === "salary" && options.ashojDue) {
        return { employee_id: 4, bs_year: 2083, bs_month: 6, month_key: "2083-06", month_label: "Ashoj 2083", earned: 24000, paid: 0, due: 24000 };
      }
      return { employee_id: 4, bs_year: 2083, bs_month: 7, month_key: "2083-07", month_label: "Kartik 2083", earned, paid, due: earned - paid };
    },
    async history(_id, monthKey) {
      calls.push(`history ${monthKey}`);
      if (monthKey === "2083-06") {
        return { employee_id: 4, month_key: "2083-06", month_label: "Ashoj 2083", payments: [], totals: { earned: 24000, paid: 0, due: 24000 } };
      }
      return history();
    },
    async employeeMonth(employeeId, monthKey) {
      calls.push(`month ${employeeId} ${monthKey}`);
      return {
        employee: kamala,
        month: { bs_year: 2083, bs_month: 7, label: "Kartik 2083", label_np: "कार्तिक २०८३", key: monthKey, ad_start: "2026-10-18", ad_end: "2026-11-16", days: [], working_days: 26 },
        cells: [],
        totals: { present: 0, overtime_days: 0, overtime_hours: 0, absent: 0, weekly_off: 0, not_marked: 0, marked_days: 0, attended: 0, paid_days: 0 },
        payments: history().payments,
      };
    },
    async pay(input) {
      const forMonth = input.for_year != null ? ` for ${input.for_year}-${input.for_month}` : "";
      calls.push(`pay ${input.kind} ${input.amount} mode${input.payment_mode_id ?? 1} ${input.source}${forMonth}`);
      if (input.for_month != null && input.for_month !== 7) {
        const other = { ...record(98, "2083-07-07", "2026-10-24", input.kind, input.amount, "2026-10-30T10:00:00Z"), for_month: input.for_month };
        return { payment: other, due_after: 0 };
      }
      paid += input.amount;
      const saved = { ...record(99, "2083-07-07", "2026-10-24", input.kind, input.amount, "2026-10-30T10:00:00Z"), source: input.source };
      payments = [saved, ...payments];
      return { payment: saved, due_after: earned - paid };
    },
  };
  if (options.settle) {
    // Payroll's salary due oldest first: Bhadra 3,000, Ashoj 18,053, Kartik so far 7,177.
    const m = (month: number, label: string, net: number, paidM: number, running = false) => ({
      month: { bs_year: 2083, bs_month: month }, label, in_progress: running, days_in_month: 31, days_counted: running ? 8 : 31,
      absent: 0, net, paid: paidM, due: net - paidM, cleared_on: null,
    });
    api.salaryDues = async () => {
      calls.push("dues");
      return {
        employee_id: 4,
        months: [m(5, "Bhadra 2083", 26940, 23940), m(6, "Ashwin 2083", 26053, 8000), m(7, "Kartik 2083", 7177, 0, true)],
        total_due: 28230, past_due: 21053, running_month: { bs_year: 2083, bs_month: 7 }, running_due: 7177,
        today: { bs: "2083-07-08", ad: "2026-10-25" },
      };
    };
    api.paySalary = async (input) => {
      calls.push(`settle ${input.amount} mode${input.payment_mode_id} ${input.source}`);
      const saved = record(120, "2083-07-08", "2026-10-25", "salary", input.amount, "2026-10-25T10:00:00Z");
      return {
        payment: saved,
        due_after: 28230 - input.amount,
        split: [{ label: "Bhadra 2083", amount: 3000, cleared: true }, { label: "Ashwin 2083", amount: input.amount - 3000, cleared: false }],
        months_label: "Bhadra – Ashwin 2083",
      };
    };
  }
  const sounds: string[] = [];
  const flow = createScanFlow({
    api,
    currentDraft: (emp) => (marked.has(emp.id) ? { status: "P", ot_hours: 0, note: "" } : { status: null, ot_hours: 0, note: "" }),
    monthKey: () => "2083-07",
    canPay: () => options.canPay ?? true,
    now: () => clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    autoReturnMs: { done: AUTO_RETURN_MS, paid: AUTO_RETURN_MS },
    sounds: {
      read: () => sounds.push("read"),
      name: (e) => sounds.push(`name ${e.name}`),
      already: (e) => sounds.push(`already ${e.name}`),
      marked: (s, h) => sounds.push(`marked ${s} ${h}`),
      paid: (_e, t, a) => sounds.push(`paid ${t} ${a}`),
      unknown: () => sounds.push("unknown"),
      skip: () => sounds.push("skip"),
    },
  });
  const step = () => flow.getState().scan?.step ?? null;
  const scan = () => flow.getState().scan as Scan;
  return { flow, clock, calls, sounds, step, scan, markedSet: marked };
}

// ---- tests

describe("scan loop", () => {
  it("a) commit → done → 3 s → camera with the summary, count 1", async () => {
    const t = setup();
    t.flow.open();
    t.flow.scan("TTK-E004");
    await flush();
    assert.equal(t.step(), "found");
    assert.deepEqual(t.sounds, ["read", "name Kamala Bhandari"]);
    t.flow.present();
    await flush();
    assert.equal(t.step(), "done");
    assert.equal(t.flow.getState().count, 1);
    const done = t.scan() as Extract<Scan, { step: "done" }>;
    assert.equal(done.summary, "✓ Kamala Bhandari · हाजिर");
    assert.ok(t.sounds.includes("marked P 0"));
    await t.clock.advance(2999);
    assert.equal(t.step(), "done");
    await t.clock.advance(1);
    assert.deepEqual(t.scan(), { step: "camera", last: "✓ Kamala Bhandari · हाजिर" });
    assert.equal(t.flow.getState().count, 1);
  });

  it("overtime summary carries the hours", async () => {
    const t = setup();
    t.flow.open();
    t.flow.scan("E-004");
    await flush();
    t.flow.otMode(true);
    t.flow.setHours(2);
    t.flow.saveOvertime();
    await flush();
    assert.equal((t.scan() as Extract<Scan, { step: "done" }>).summary, "✓ Kamala Bhandari · हाजिर + 2 h");
    assert.ok(t.calls.includes("mark E-004 overtime 2"));
  });

  it("b) done → Scan next at 1 s → camera; the later timer does nothing", async () => {
    const t = setup();
    t.flow.open();
    t.flow.scan("E-004");
    await flush();
    t.flow.present();
    await flush();
    await t.clock.advance(1000);
    t.flow.scanNext();
    assert.deepEqual(t.scan(), { step: "camera", last: "✓ Kamala Bhandari · हाजिर" });
    // A new person is on screen when the old timer would have fired.
    t.flow.scan("E-011");
    await flush();
    assert.equal(t.step(), "found");
    await t.clock.advance(AUTO_RETURN_MS);
    assert.equal(t.step(), "found");
  });

  it("c) done → Stop at 1 s → closed; the later timer does nothing", async () => {
    const t = setup();
    t.flow.open();
    t.flow.scan("E-004");
    await flush();
    t.flow.present();
    await flush();
    await t.clock.advance(1000);
    t.flow.stop();
    assert.equal(t.scan(), null);
    assert.equal(t.flow.getState().count, 0);
    await t.clock.advance(AUTO_RETURN_MS);
    assert.equal(t.scan(), null);
  });

  it("d) skip from found / already / pay / missing → camera, no API write", async () => {
    const t = setup();
    t.flow.open();
    t.flow.scan("E-004");
    await flush();
    t.flow.skip();
    assert.deepEqual(t.scan(), { step: "camera", last: "Skipped Kamala Bhandari" });
    assert.equal(t.sounds.at(-1), "skip");

    t.markedSet.add(4);
    await t.clock.advance(4000); // past the repeat-ignore window
    t.flow.scan("E-004");
    await flush();
    assert.equal(t.step(), "already");
    t.flow.skip();
    assert.equal(t.step(), "camera");

    await t.clock.advance(4000);
    t.flow.scan("E-004");
    await flush();
    t.flow.choosePayment("advance");
    t.flow.setPick("1500");
    await flush();
    assert.equal(t.step(), "pay");
    t.flow.skip();
    assert.deepEqual(t.scan(), { step: "camera", last: "Skipped Kamala Bhandari" });

    await t.clock.advance(4000);
    t.flow.scan("TTK-X917");
    await flush();
    assert.equal(t.step(), "missing");
    assert.equal(t.sounds.at(-1), "unknown");
    t.flow.skip();
    assert.deepEqual(t.scan(), { step: "camera" });

    assert.ok(!t.calls.some((c) => c.startsWith("mark") || c.startsWith("pay")));
    assert.equal(t.flow.getState().count, 0);
  });

  it("e) OT picker → otBack → found with mode null (no skip)", async () => {
    const t = setup();
    t.flow.open();
    t.flow.scan("E-004");
    await flush();
    t.flow.otMode(true);
    assert.equal((t.scan() as Extract<Scan, { step: "found" }>).mode, "ot");
    t.flow.otBack();
    const s = t.scan() as Extract<Scan, { step: "found" }>;
    assert.equal(s.step, "found");
    assert.equal(s.mode, null);
    assert.ok(!t.sounds.includes("skip"));
    // Back maps the same way: picker → choice, then choice → skip.
    t.flow.otMode(true);
    assert.equal(t.flow.back(), true);
    assert.equal((t.scan() as Extract<Scan, { step: "found" }>).mode, null);
    assert.equal(t.flow.back(), true);
    assert.equal(t.step(), "camera");
    assert.equal(t.flow.back(), false);
    assert.equal(t.scan(), null);
  });

  it("f) pay → openHistory → historyBack keeps type and amount", async () => {
    const t = setup({ marked: new Set([4]) });
    t.flow.open();
    t.flow.scan("E-004");
    await flush();
    assert.equal(t.step(), "already");
    t.flow.choosePayment("advance");
    t.flow.setPick("custom");
    t.flow.setAmount("1,250");
    await flush();
    t.flow.openHistory();
    await flush();
    assert.equal(t.step(), "history");
    t.flow.historyBack();
    const s = t.scan() as Extract<Scan, { step: "pay" }>;
    assert.equal(s.step, "pay");
    assert.equal(s.type, "advance");
    assert.equal(s.pick, "custom");
    assert.equal(s.amount, "1250");
    assert.equal(amountOf(s), 1250);
  });

  it("g) history lists newest first; a saved payment appears on top; empty state when none", async () => {
    const t = setup({ marked: new Set([4]) });
    t.flow.open();
    t.flow.scan("E-004");
    await flush();
    t.flow.choosePayment("advance");
    await flush();
    t.flow.openHistory();
    await flush();
    let h = t.scan() as Extract<Scan, { step: "history" }>;
    assert.deepEqual(h.history?.map((p) => p.amount), [3000, 2000]);
    assert.equal(h.balance?.paid, 5000);
    t.flow.historyBack();
    t.flow.setPick("1500");
    t.flow.savePayment();
    await flush();
    assert.equal(t.step(), "paid");
    assert.equal((t.scan() as Extract<Scan, { step: "paid" }>).summary, "✓ Kamala Bhandari · Advance Rs 1,500");
    assert.ok(t.calls.includes("pay advance 1500 mode1 scan"));
    assert.equal((t.scan() as Extract<Scan, { step: "paid" }>).paid.payment.receipt_no, "ADV-0099");
    assert.equal(t.sounds.at(-1), "paid advance 1500");
    await t.clock.advance(AUTO_RETURN_MS);
    assert.equal(t.step(), "camera");
    await t.clock.advance(4000);
    t.flow.scan("E-004");
    await flush();
    t.flow.choosePayment("salary");
    await flush();
    t.flow.openHistory();
    await flush();
    h = t.scan() as Extract<Scan, { step: "history" }>;
    assert.deepEqual(h.history?.map((p) => p.amount), [1500, 3000, 2000]);
    assert.equal(h.balance?.paid, 6500);
    assert.equal(h.pick, "full");
    assert.equal(amountOf(h), 13500);
    // Empty state: a history with no rows.
    assert.equal(amountError({ pick: "custom", amount: "", balance: h.balance }), "Enter an amount above 0.");
    assert.match(amountError({ pick: "custom", amount: "99999", balance: h.balance }) ?? "", /More than the balance due/);
  });

  it("h) commit API error → stays on found with an inline error, no timer", async () => {
    const t = setup({ markFails: true });
    t.flow.open();
    t.flow.scan("E-004");
    await flush();
    t.flow.present();
    await flush();
    const s = t.scan() as Extract<Scan, { step: "found" }>;
    assert.equal(s.step, "found");
    assert.equal(s.busy, false);
    assert.equal(s.error, "Server busy");
    assert.equal(t.flow.getState().count, 0);
    await t.clock.advance(AUTO_RETURN_MS + 1);
    assert.equal(t.step(), "found");
  });

  it("i) the same code within 3 s is ignored; a different one is not", async () => {
    const t = setup();
    t.flow.open();
    t.flow.scan("E-004");
    await flush();
    t.flow.skip();
    await t.clock.advance(1000);
    t.flow.scan("E-004");
    await flush();
    assert.equal(t.step(), "camera");
    assert.equal(t.calls.filter((c) => c.startsWith("lookup")).length, 1);
    t.flow.scan("E-011");
    await flush();
    assert.equal(t.step(), "found");
    // Decodes while a sheet is open are ignored.
    t.flow.scan("E-004");
    await flush();
    assert.equal((t.scan() as Extract<Scan, { step: "found" }>).emp.id, 11);
  });

  it("a new card while done is showing cancels the timer and is handled at once (desktop)", async () => {
    const t = setup();
    t.flow.scan("E-004"); // desktop: the first code opens the flow
    await flush();
    assert.equal(t.step(), "found");
    t.flow.present();
    await flush();
    assert.equal(t.step(), "done");
    await t.clock.advance(1000);
    t.flow.scan("E-011");
    await flush();
    assert.equal(t.step(), "found");
    await t.clock.advance(AUTO_RETURN_MS);
    assert.equal(t.step(), "found");
    assert.equal(t.flow.getState().count, 1);
  });

  it("payment record and attendance record open from the already sheet and go back there", async () => {
    const t = setup({ marked: new Set([4]) });
    t.flow.open();
    t.flow.scan("E-004");
    await flush();
    t.flow.openPaymentRecord();
    await flush();
    assert.equal(t.step(), "history");
    assert.equal((t.scan() as Extract<Scan, { step: "history" }>).from, "already");
    t.flow.historyBack();
    assert.equal(t.step(), "already");
    t.flow.openAttendanceRecord();
    await flush();
    const rec = t.scan() as Extract<Scan, { step: "attrec" }>;
    assert.equal(rec.step, "attrec");
    assert.equal(rec.monthKey, "2083-07");
    assert.ok(rec.month);
    t.flow.recordMonth(-1);
    await flush();
    assert.equal((t.scan() as Extract<Scan, { step: "attrec" }>).monthKey, "2083-06");
    t.flow.recordMonth(2); // the future is locked
    assert.equal((t.scan() as Extract<Scan, { step: "attrec" }>).monthKey, "2083-06");
    t.flow.recordDay(15);
    assert.equal(t.flow.back(), true); // closes the day pop-up first
    assert.equal((t.scan() as Extract<Scan, { step: "attrec" }>).dayPop, null);
    assert.equal(t.flow.back(), true);
    assert.equal(t.step(), "already");
    assert.equal(shiftMonthKey("2083-01", -1), "2082-12");
  });

  it("salary counts for payroll's settlement month, advance for the running month; Paid by is sent", async () => {
    const t = setup({ marked: new Set([4]), ashojDue: true });
    t.flow.open();
    t.flow.scan("E-004");
    await flush();
    t.flow.choosePayment("salary");
    await flush();
    const pay = t.scan() as Extract<Scan, { step: "pay" }>;
    assert.equal(pay.balance?.month_label, "Ashoj 2083");
    assert.equal(pay.mode, 1);
    assert.ok(t.calls.includes("balance salary") && t.calls.includes("history 2083-06"));
    t.flow.setMode(7);
    t.flow.savePayment(); // pick "full" is the default for salary
    await flush();
    assert.equal(t.step(), "paid");
    assert.ok(t.calls.includes("pay salary 24000 mode7 scan for 2083-6"), t.calls.join(" | "));
    assert.equal((t.scan() as Extract<Scan, { step: "paid" }>).monthLabel, "Ashoj 2083");
    await t.clock.advance(AUTO_RETURN_MS + 4000);
    t.flow.scan("E-004");
    await flush();
    t.flow.choosePayment("advance");
    await flush();
    t.flow.setPick("500");
    t.flow.savePayment();
    await flush();
    assert.ok(t.calls.includes("pay advance 500 mode1 scan"), "an advance sends no for_*");
  });

  it("salary with payroll's salary due: one amount, oldest month first, capped at the total", async () => {
    const t = setup({ marked: new Set([4]), settle: true });
    t.flow.open();
    t.flow.scan("E-004");
    await flush();
    t.flow.choosePayment("salary");
    let pay = t.scan() as Extract<Scan, { step: "pay" }>;
    assert.equal(pay.dues, null, "loading");
    assert.equal(amountError(pay), "Loading the salary due…");
    await flush();
    pay = t.scan() as Extract<Scan, { step: "pay" }>;
    assert.ok(t.calls.includes("dues"));
    // Default: everything due for past months.
    assert.equal(pay.pick, "past");
    assert.equal(amountOf(pay), 21053);
    t.flow.setPick("full");
    assert.equal(amountOf(t.scan() as Extract<Scan, { step: "pay" }>), 28230);
    t.flow.setPick("custom");
    t.flow.setAmount("28231");
    assert.equal(
      amountError(t.scan() as Extract<Scan, { step: "pay" }>),
      "More than the total due (Rs 28,230). Kartik can only be paid up to what is earned so far.",
    );
    t.flow.savePayment();
    await flush();
    assert.equal(t.step(), "pay", "over the total is not sent");
    assert.ok(!t.calls.some((c) => c.startsWith("settle")));
    t.flow.setAmount("5000");
    t.flow.setMode(7);
    t.flow.savePayment();
    await flush();
    assert.equal(t.step(), "paid");
    assert.ok(t.calls.includes("settle 5000 mode7 scan"), t.calls.join(" | "));
    assert.ok(!t.calls.some((c) => c.startsWith("pay salary")), "not the one-month payment");
    const paid = t.scan() as Extract<Scan, { step: "paid" }>;
    assert.equal(paid.monthLabel, "Bhadra – Ashwin 2083");
    assert.deepEqual(
      paid.split?.map((x) => [x.label, x.amount, x.cleared]),
      [
        ["Bhadra 2083", 3000, true],
        ["Ashwin 2083", 2000, false],
      ],
    );
    assert.equal(paid.paid.due_after, 23230);
    assert.ok(t.sounds.includes("paid salary 5000"));
  });

  it("no salary set up yet: the pay sheet keeps payroll's code so it can offer the Salary tab", async () => {
    const noSalary = Object.assign(new Error("No salary set up yet — add it in the Salary tab."), { status: 404, code: "no_salary" });
    const t = setup({ marked: new Set([4]), balanceFails: noSalary });
    t.flow.open();
    t.flow.scan("E-004");
    await flush();
    t.flow.choosePayment("salary");
    await flush();
    const pay = t.scan() as Extract<Scan, { step: "pay" }>;
    assert.equal(pay.step, "pay");
    assert.equal(pay.error, "No salary set up yet — add it in the Salary tab.");
    assert.equal(pay.errorCode, "no_salary");
  });

  it("without salary_advances there are no pay steps or payment record", async () => {
    const t = setup({ marked: new Set([4]), canPay: false });
    t.flow.open();
    t.flow.scan("E-004");
    await flush();
    assert.equal(t.step(), "already");
    t.flow.choosePayment("salary");
    t.flow.openPaymentRecord();
    assert.equal(t.step(), "already");
    t.flow.openHistoryFor(kamala, { status: "P", ot_hours: 0, note: "" });
    assert.equal(t.step(), "already");
    assert.ok(!t.calls.some((c) => c.startsWith("balance") || c.startsWith("history")));
  });

  it("history and record opened from the list close on Back", async () => {
    const t = setup();
    t.flow.openHistoryFor(kamala, { status: "P", ot_hours: 0, note: "" });
    await flush();
    assert.equal(t.step(), "history");
    assert.equal(t.flow.back(), false);
    assert.equal(t.scan(), null);
    t.flow.openRecordFor(kamala, { status: "P", ot_hours: 0, note: "" }, "2083-07");
    await flush();
    assert.equal(t.step(), "attrec");
    t.flow.skip();
    assert.equal(t.scan(), null);
  });

  it("dispose clears the timer and stops notifying", async () => {
    const t = setup();
    let notified = 0;
    t.flow.subscribe(() => notified++);
    t.flow.open();
    t.flow.scan("E-004");
    await flush();
    t.flow.present();
    await flush();
    const before = notified;
    t.flow.dispose();
    await t.clock.advance(AUTO_RETURN_MS);
    assert.equal(notified, before);
  });
});
