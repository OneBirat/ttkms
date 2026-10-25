import { test } from "node:test";
import assert from "node:assert/strict";
import {
  afterText,
  allocate,
  clearedText,
  coverState,
  defaultAmount,
  dueMonthSub,
  monthsText,
  overMessage,
  parseTyped,
  paymentEntries,
  quickAmounts,
  settledText,
  splitChips,
} from "../_lib/settle.ts";

const month = (m, net, paid, extra = {}) => ({
  month: { bs_year: 2083, bs_month: m },
  label: ["", "Baishakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin", "Kartik"][m] + " 2083",
  in_progress: false,
  days_in_month: 31,
  days_counted: 31,
  absent: 0,
  net,
  paid,
  due: Math.max(0, net - paid),
  cleared_on: null,
  ...extra,
});
// The design's sample: Bhadra 3,000 due, Ashwin 18,053 due, Kartik so far 7,177 (running).
const months = [
  month(5, 26940, 23940),
  month(6, 26053, 8000, { absent: 2 }),
  month(7, 7177, 0, { in_progress: true, days_counted: 8 }),
];
const dues = {
  employee_id: 6,
  months,
  total_due: 3000 + 18053 + 7177,
  past_due: 3000 + 18053,
  running_month: { bs_year: 2083, bs_month: 7 },
  running_due: 7177,
  today: { bs: "2083-07-08", ad: "2026-10-25" },
};

test("allocate: oldest month first, cleared months skipped, never more than due", () => {
  const split = allocate(5000, months);
  assert.deepEqual(
    split.map((a) => [a.month.label, a.amount, a.full]),
    [
      ["Bhadra 2083", 3000, true],
      ["Ashwin 2083", 2000, false],
    ],
  );
  assert.deepEqual(
    allocate(dues.total_due, months).map((a) => a.amount),
    [3000, 18053, 7177],
  );
  assert.ok(allocate(dues.total_due, months).every((a) => a.full));
  const withCleared = [month(4, 22000, 22000, { cleared_on: { bs: "2083-05-02", ad: "2026-08-18" } }), ...months];
  assert.equal(allocate(1000, withCleared)[0].month.label, "Bhadra 2083");
  assert.deepEqual(allocate(0, months), []);
});

test("default amount, quick amounts and the over-total message", () => {
  assert.equal(defaultAmount(dues), 21053);
  assert.equal(defaultAmount({ ...dues, past_due: 0, total_due: 7177 }), 7177);
  assert.deepEqual(
    quickAmounts(dues).map((q) => q.label),
    ["All past months 21,053", "Everything incl. Kartik 28,230", "5,000", "10,000"],
  );
  // Nothing due for the running month: "Everything incl." would repeat "All past months".
  assert.deepEqual(
    quickAmounts({ ...dues, total_due: 21053, running_due: 0 }).map((q) => q.value),
    [21053, 5000, 10000],
  );
  // Small dues: the fixed amounts above the total are left out.
  assert.deepEqual(
    quickAmounts({ ...dues, past_due: 3000, total_due: 4000 }).map((q) => q.value),
    [3000, 4000],
  );
  assert.equal(overMessage(dues), "More than the total due (Rs 28,230). Kartik can only be paid up to what is earned so far.");
});

test("texts: month sub-line, cleared, covers pill, done chips and the line after", () => {
  assert.equal(dueMonthSub(months[1]), "31 days · 2 absent");
  assert.equal(dueMonthSub(months[2]), "running · earned so far");
  assert.equal(clearedText("2083-07-08"), "Cleared Kartik 8");
  assert.equal(settledText(month(4, 22000, 22000, { cleared_on: { bs: "2083-05-02", ad: "" } })), "Cleared Bhadra 2");
  assert.equal(settledText(month(7, 0, 0)), "Nothing due");
  const [bhadra, ashwin] = allocate(5000, months);
  assert.equal(coverState(bhadra, "2083-07-08"), "Cleared Kartik 8");
  assert.equal(coverState(ashwin, "2083-07-08"), "Rs 16,053 left");
  const result = {
    receipt_no: "SAL-0414",
    payment_group_id: 1,
    amount: 5000,
    payment_mode: { id: 1, type: "cash", name: "Cash" },
    date: { bs: "2083-07-08", ad: "2026-10-25" },
    reference: null,
    payments: [],
    split: [
      { payment_id: 1, month: { bs_year: 2083, bs_month: 5 }, label: "Bhadra 2083", amount: 3000, due_before: 3000, due_after: 0, cleared_on: { bs: "2083-07-08", ad: "2026-10-25" } },
      { payment_id: 2, month: { bs_year: 2083, bs_month: 6 }, label: "Ashwin 2083", amount: 2000, due_before: 18053, due_after: 16053, cleared_on: null },
    ],
    total_due_after: 23230,
  };
  assert.deepEqual(splitChips(result), [
    { text: "Bhadra Rs 3,000 · cleared Kartik 8", cleared: true },
    { text: "Ashwin Rs 2,000", cleared: false },
  ]);
  assert.equal(afterText(result), "Still due: Rs 23,230");
  assert.equal(afterText({ ...result, total_due_after: 0 }), "Nothing due now · all cleared Kartik 8");
  assert.equal(parseTyped("Rs 1,500"), 1500);
  assert.equal(parseTyped(""), 0);
});

test("payment entries: a group's rows fold into one, singles pass through", () => {
  const p = (id, m, amount, group = null) => ({ id, month: { bs_year: 2083, bs_month: m }, amount, payment_group_id: group });
  const entries = paymentEntries([p(9, 7, 500), p(12, 6, 5000, 11), p(11, 5, 3000, 11), p(3, 5, 100)]);
  assert.deepEqual(
    entries.map((e) => [e.payment.id, e.payment.amount, e.ids]),
    [
      [9, 500, [9]],
      [12, 8000, [12, 11]],
      [3, 100, [3]],
    ],
  );
  assert.equal(monthsText(entries[1].months), "Bhadra – Ashwin");
  assert.equal(monthsText(entries[0].months), "Kartik");
});
