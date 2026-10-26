import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PaymentRemarks, bulkMonths, noteMeta, noteWhen } from "../_components/PaymentRemarks";
import type { Payment } from "../types";

const base = {
  id: 40,
  receipt_no: "SAL-0007",
  employee_id: 3,
  for_year: 2083,
  for_month: 2,
  month: { bs_year: 2083, bs_month: 2 },
  kind: "salary",
  amount: 54000,
  payment_mode_id: 1,
  payment_mode: { id: 1, name: "Cash", type: "cash" },
  reference: null,
  system_remark: "Bulk salary payment · Ashwin Rs 30,000 (cleared) · Kartik Rs 24,000 (part, Rs 6,000 left)",
  note: null,
  date: { bs: "2083-07-09", ad: "2026-10-26" },
  paid_at: "2026-10-26T09:22:00Z",
  recorded_by: "Ram Admin",
  source: "account",
  created_at: "2026-10-26T09:22:00Z",
} as unknown as Payment;

const months = [
  { for_year: 2083, for_month: 6, amount: 30000, cleared: true },
  { for_year: 2083, for_month: 7, amount: 24000, cleared: false },
];

const render = (payment: Payment, canEdit: boolean) =>
  renderToStaticMarkup(createElement(PaymentRemarks, { payment, months, canEdit }));

describe("payment remarks", () => {
  it("bulk = several months on one row", () => {
    assert.equal(bulkMonths({ group_months: months }), 2);
    assert.equal(bulkMonths({ group_months: [months[0]] }), 0);
    assert.equal(bulkMonths({ group_months: null }), 0);
  });

  it("system remark is read-only with a ✓ chip per cleared month; + Add note when allowed", () => {
    const html = render(base, true);
    assert.match(html, /data-testid="system-remark"/);
    assert.match(html, /System<\/span>/);
    assert.match(html, /Bulk salary payment · Ashwin Rs 30,000 \(cleared\)/);
    assert.match(html, /✓ Ashwin/);
    assert.doesNotMatch(html, /✓ Kartik/);
    assert.doesNotMatch(html, /<textarea/);
    assert.match(html, /\+ Add note/);
    assert.doesNotMatch(render(base, false), /Add note|Edit/);
  });

  it("note box: text, who and when (Kathmandu, BS), Edit only with salary_advances", () => {
    const noted = { ...base, note: "Paid at home", note_updated_by: "Ram Admin", note_updated_at: "2026-10-26T09:22:00Z" };
    assert.equal(noteWhen("2026-10-26T09:22:00Z"), "Kartik 9, 2083, 3:07 pm");
    assert.equal(noteMeta(noted), "Note · Ram Admin · Kartik 9, 2083, 3:07 pm");
    const html = render(noted, true);
    assert.match(html, /data-testid="payment-note"/);
    assert.match(html, /Paid at home/);
    assert.match(html, />Edit</);
    assert.doesNotMatch(html, /Add note/);
    assert.doesNotMatch(render(noted, false), />Edit</);
  });
});
