import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as api from "../_lib/mockApi.ts";
import { mockAttendance } from "../_lib/mockData.ts";
import { addMonths, monthKey, rangeFor, thisMonth, today } from "../_lib/months.ts";

/** A fixed "now" (Kartik 7, 2083) so the seed is stable whatever the real date. */
const NOW = new Date("2026-10-24T06:00:00Z");
const CURRENT = thisMonth(NOW);
const PREVIOUS = addMonths(CURRENT, -1);

beforeEach(async () => {
  await api.resetMockData(NOW);
});

test("seed: 25 employees, codes and barcodes, both pay types, next code E-026", async () => {
  const employees = await api.listEmployees();
  assert.equal(employees.length, 25);
  assert.equal(employees[0].code, "E-001");
  assert.equal(employees[0].barcode, "TTK-E001");
  assert.deepEqual(await api.nextEmployeeCode(), { code: "E-026", barcode: "TTK-E026" });
  const structures = await Promise.all(employees.map((e) => api.getSalaryStructure(e.id)));
  const types = new Set(structures.map((s) => s.current.pay_type));
  assert.deepEqual([...types].sort(), ["daily", "monthly"]);
  assert.ok(structures.every((s) => s.current.gross === s.current.basic + s.current.allowances));
  assert.ok(structures.every((s) => s.current.ot_rate > 0));
});

test("mock attendance has the contract shape: no late / half / leave", () => {
  const s = mockAttendance(1, PREVIOUS, NOW);
  assert.deepEqual(Object.keys(s).sort(), [
    "absent", "days_in_month", "overtime_days", "overtime_hours", "paid_days", "present", "weekly_off",
  ]);
  assert.equal(s.present + s.absent + s.weekly_off, s.days_in_month);
  assert.equal(s.paid_days, s.days_in_month - s.absent);
  assert.ok(Number.isInteger(s.overtime_hours));
  const running = mockAttendance(1, CURRENT, NOW);
  assert.ok(running.present + running.absent + running.weekly_off <= 7);
});

test("ledger: six months newest first, running month flagged, net = earnings − absence − tds", async () => {
  const ledger = await api.getLedger(1);
  assert.equal(ledger.length, 6);
  assert.deepEqual(ledger[0].month, CURRENT);
  assert.ok(ledger[0].in_progress);
  assert.ok(!ledger[1].in_progress);
  for (const row of ledger) {
    assert.equal(row.earnings, row.gross_salary + row.overtime_pay);
    assert.equal(row.net, row.earnings - row.absence_deduction - row.tds);
    assert.equal(row.paid, row.salary_paid + row.advance_paid);
    assert.equal(row.due, Math.max(0, row.net - row.paid));
    assert.ok(!("ssf" in row));
  }
  // Older months are fully paid in the seed.
  assert.equal(ledger[5].status, "paid");
  assert.equal(ledger[5].due, 0);
});

test("ledger starts at the joining month", async () => {
  const employees = await api.listEmployees();
  const newest = employees.find((e) => e.joined.bs >= "2082-09-01");
  const ledger = await api.getLedger(newest.id);
  assert.ok(ledger.length <= 6);
  assert.ok(ledger.every((l) => monthKey(l.month) >= newest.joined.bs.slice(0, 7)));
});

test("last month has paid, part paid and pending staff", async () => {
  const report = await api.getSalaryReport(PREVIOUS);
  const statuses = new Set(report.rows.map((r) => r.ledger.status));
  assert.deepEqual([...statuses].sort(), ["paid", "part_paid", "pending"]);
  assert.equal(report.totals.paid_count + report.totals.part_paid_count + report.totals.pending_count, report.rows.length);
  assert.equal(report.totals.net, report.rows.reduce((s, r) => s + r.ledger.net, 0));
  assert.ok(report.totals.advance_paid > 0);
  assert.equal(report.trend.length, 5);
  assert.deepEqual(report.trend.at(-1).month, PREVIOUS);
  assert.equal(report.by_department.length, 5);
});

test("department filter narrows rows but not the chips", async () => {
  const all = await api.getSalaryReport(PREVIOUS);
  const kitchen = await api.getSalaryReport(PREVIOUS, 2);
  assert.ok(kitchen.rows.length < all.rows.length);
  assert.ok(kitchen.rows.every((r) => r.employee.department.id === 2));
  assert.equal(kitchen.all_staff, all.rows.length);
  assert.equal(kitchen.by_department.length, 5);
});

test("balance matches the ledger and payments reduce the due", async () => {
  const pending = (await api.getSalaryReport(PREVIOUS)).rows.find((r) => r.ledger.status === "pending");
  const id = pending.employee.id;
  const before = await api.getBalance(id, PREVIOUS);
  assert.equal(before.due, before.earned);
  assert.equal(before.month_label, `${["Baishakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"][PREVIOUS.bs_month - 1]} ${PREVIOUS.bs_year}`);

  // A part salary payment for last month, paid today: it counts for last month.
  const part = await api.recordPayment({
    employee_id: id, for_year: PREVIOUS.bs_year, for_month: PREVIOUS.bs_month,
    kind: "salary", amount: 1500, payment_mode_id: 1, source: "account",
  });
  assert.equal(part.due_after, before.earned - 1500);
  assert.equal(part.payment.recorded_by, "admin");
  assert.equal(part.payment.date.bs, today().bs);
  assert.deepEqual([part.payment.for_year, part.payment.for_month], [PREVIOUS.bs_year, PREVIOUS.bs_month]);

  const mid = await api.getBalance(id, PREVIOUS);
  assert.equal(mid.status, "part_paid");
  assert.equal(mid.breakdown.salary_paid, 1500);

  // Advances only go against the running month, up to earned so far − paid.
  const running = await api.getBalance(id, CURRENT);
  const advance = await api.recordPayment({
    employee_id: id, for_year: CURRENT.bs_year, for_month: CURRENT.bs_month,
    kind: "advance", amount: 500, payment_mode_id: 1, source: "scan",
  });
  assert.equal(advance.due_after, running.due - 500);
  await assert.rejects(
    api.recordPayment({ employee_id: id, for_year: PREVIOUS.bs_year, for_month: PREVIOUS.bs_month, kind: "advance", amount: 100, payment_mode_id: 1, source: "scan" }),
    /running month/,
  );

  const salary = await api.recordPayment({
    employee_id: id, for_year: PREVIOUS.bs_year, for_month: PREVIOUS.bs_month,
    kind: "salary", amount: mid.due, payment_mode_id: 2, reference: "NBL-1", source: "account",
  });
  assert.equal(salary.due_after, 0);
  const after = await api.getBalance(id, PREVIOUS);
  assert.equal(after.status, "paid");
  assert.equal(after.due, 0);
  const ledger = await api.getMonthLedger(id, PREVIOUS);
  assert.equal(ledger.payments.length, 2);
});

test("payments: 0, above due, future month and future date are refused", async () => {
  const pending = (await api.getSalaryReport(PREVIOUS)).rows.find((r) => r.ledger.status === "pending");
  const base = { employee_id: pending.employee.id, for_year: PREVIOUS.bs_year, for_month: PREVIOUS.bs_month, payment_mode_id: 1, source: "account" };
  await assert.rejects(api.recordPayment({ ...base, kind: "salary", amount: 0 }), /above 0/);
  await assert.rejects(api.recordPayment({ ...base, kind: "salary", amount: pending.ledger.due + 1 }), /More than the balance due/);
  const next = addMonths(CURRENT, 1);
  await assert.rejects(api.recordPayment({ ...base, for_year: next.bs_year, for_month: next.bs_month, kind: "advance", amount: 100 }), /not started/);
  await assert.rejects(api.recordPayment({ ...base, kind: "salary", amount: 100, date_bs: "2099-01-01" }), /future/);
});

test("payments register: BS date range + type filter, settlement-month totals, by_employee", async () => {
  const all = await api.listPayments({ from_bs: null, to_bs: null, type: "all" });
  assert.ok(all.rows.length > 25);
  const range = rangeFor("last_month", NOW);
  const advances = await api.listPayments({ ...range, type: "advance" });
  assert.ok(advances.rows.length > 0);
  assert.ok(advances.rows.every((r) => r.payment.kind === "advance" && r.payment.date.bs >= range.from_bs && r.payment.date.bs <= range.to_bs));
  assert.equal(advances.totals.amount, advances.rows.reduce((s, r) => s + r.payment.amount, 0));
  assert.equal(advances.totals.count, advances.rows.length);
  // Tiles describe the settlement month (last month while anything is due for it).
  assert.deepEqual(advances.totals.month, PREVIOUS);
  const report = await api.getSalaryReport(PREVIOUS);
  assert.equal(advances.totals.month_net, report.totals.net);
  assert.equal(advances.totals.due, report.totals.due);
  assert.equal(advances.totals.advance_paid, report.totals.advance_paid);
  assert.equal(advances.by_employee.length, report.rows.length);
  assert.equal(advances.by_employee.reduce((s, r) => s + r.due, 0), report.totals.due);
  // Newest first; every payment carries a mode and a receipt number.
  for (let i = 1; i < all.rows.length; i += 1) assert.ok(all.rows[i - 1].payment.date.bs >= all.rows[i].payment.date.bs);
  assert.ok(all.rows.every((r) => r.payment.payment_mode_id >= 1 && r.payment.payment_mode.name && /^(ADV|SAL)-\d{4}$/.test(r.payment.receipt_no)));
  await assert.rejects(api.listPayments({ from_bs: "2083-07-05", to_bs: "2083-07-01", type: "all" }), /after/);
});

test("payment modes: Cash first, inactive hidden, type rules enforced on save", async () => {
  const active = await api.listPaymentModes();
  assert.equal(active[0].type, "cash");
  assert.ok(active.every((m) => m.active));
  const everything = await api.listPaymentModes(false);
  assert.ok(everything.length > active.length);
  assert.deepEqual(Object.keys(active[0]).sort(), ["active", "details", "id", "name", "type", "use_advance", "use_salary"]);
  const report = await api.getSalaryReport(PREVIOUS);
  const pending = report.rows.find((r) => r.ledger.status === "pending");
  const base = { employee_id: pending.employee.id, for_year: PREVIOUS.bs_year, for_month: PREVIOUS.bs_month, source: "account" };
  // Khalti is advances-only in the sample; Cheque is switched off.
  const khalti = everything.find((m) => m.name === "Khalti");
  const cheque = everything.find((m) => m.type === "cheque");
  await assert.rejects(api.recordPayment({ ...base, kind: "salary", amount: 100, payment_mode_id: khalti.id }), /not set up for salary/);
  await assert.rejects(api.recordPayment({ ...base, kind: "salary", amount: 100, payment_mode_id: cheque.id }), /switched off/);
  await assert.rejects(api.recordPayment({ ...base, kind: "salary", amount: 100, payment_mode_id: 999 }), /Choose how/);
  // Default is Cash; a bank mode keeps the reference, cash drops it.
  const cash = await api.recordPayment({ ...base, kind: "salary", amount: 100, reference: "ignored" });
  assert.equal(cash.payment.payment_mode.type, "cash");
  assert.equal(cash.payment.reference, null);
  const bank = await api.recordPayment({ ...base, kind: "salary", amount: 100, payment_mode_id: 2, reference: "NIC 1" });
  assert.equal(bank.payment.payment_mode.name, "NIC Asia Bank");
  assert.equal(bank.payment.reference, "NIC 1");
});

test("transaction ledger: running balance ends at the balance due, totals add up", async () => {
  const ledger = await api.getEmployeeLedger(1);
  const months = await api.getLedger(1);
  assert.ok(ledger.entries.length > 0);
  let running = 0;
  for (let i = 0; i < ledger.entries.length; i += 1) {
    const e = ledger.entries[i];
    running += e.earned - e.paid;
    assert.equal(e.balance, running);
    if (i > 0) assert.ok(e.date.bs >= ledger.entries[i - 1].date.bs);
  }
  assert.equal(ledger.totals.balance, months.reduce((s, l) => s + l.due, 0));
  assert.equal(ledger.totals.salary + ledger.totals.overtime - ledger.totals.advances - ledger.totals.salary_payments, running);
  assert.equal(ledger.totals.advance_count, ledger.entries.filter((e) => e.type === "advance").length);
  const first = ledger.entries.find((e) => e.in_progress);
  assert.ok(first && first.date.bs === today().bs);
});

test("account summary: room = earned so far − paid this month, never negative", async () => {
  const s = await api.getAccountSummary(1);
  assert.deepEqual(s.month, CURRENT);
  assert.equal(s.room, Math.max(0, s.earned_so_far - s.paid_this_month));
  assert.ok(s.recent.length > 0);
  for (let i = 1; i < s.recent.length; i += 1) assert.ok(s.recent[i - 1].date.bs >= s.recent[i].date.bs);
  const rows = await api.listEmployeeRows(null);
  assert.equal(rows.find((r) => r.employee.id === 1).balance_due, s.balance_due);
  const row = rows.find((r) => r.employee.id === 1);
  assert.ok(["present", "overtime", "absent", "weekly_off", "not_marked"].includes(row.today));
  const branch2 = await api.listEmployeeRows(2);
  assert.ok(branch2.length > 0 && branch2.every((r) => r.employee.branch.id === 2));
});

test("suggestPayMonth: last month while due, else the running month", async () => {
  const report = await api.getSalaryReport(PREVIOUS);
  const pending = report.rows.find((r) => r.ledger.status === "pending").employee.id;
  const paid = report.rows.find((r) => r.ledger.status === "paid").employee.id;
  assert.deepEqual(await api.suggestPayMonth(pending), PREVIOUS);
  assert.deepEqual(await api.suggestPayMonth(paid), CURRENT);
});

test("createEmployee: auto code and barcode, default overtime rate, default joined today", async () => {
  const created = await api.createEmployee({
    full_name: "Test Person", phone: "9800000001", branch_id: 1, department_id: 2,
    designation: "Cook", pay_type: "monthly", amount: 24000, paid_by: "bank",
    login: { username: "test.p", role: "staff" },
  });
  assert.equal(created.employee.code, "E-026");
  assert.equal(created.employee.barcode, "TTK-E026");
  assert.equal(created.employee.joined.bs, today().bs);
  assert.ok(created.one_time_password.length >= 8);
  const structure = (await api.getSalaryStructure(created.employee.id)).current;
  assert.equal(structure.gross, 24000);
  assert.ok(structure.ot_rate > 0);
  const days = (await api.getLedger(created.employee.id))[0].attendance.days_in_month;
  assert.equal(structure.ot_rate, Math.round(24000 / days / 8));
  const byBarcode = await api.getEmployeeByBarcode("ttk-e026");
  assert.equal(byBarcode.id, created.employee.id);
});

test("createEmployee: duplicate phone and username are 409 with the field", async () => {
  const [first] = await api.listEmployees();
  const base = { full_name: "Dup", branch_id: 1, department_id: 1, designation: "x", pay_type: "daily", amount: 500, paid_by: "cash" };
  await assert.rejects(api.createEmployee({ ...base, phone: first.phone }), (e) => e.status === 409 && e.field === "phone");
  await assert.rejects(
    api.createEmployee({ ...base, phone: "9811111111", login: { username: "anita.g", role: "staff" } }),
    (e) => e.status === 409 && e.field === "username",
  );
  await assert.rejects(api.createEmployee({ ...base, phone: "" }), (e) => e.status === 422 && e.field === "phone");
});

test("reviseSalary: new structure becomes current and keeps the previous gross", async () => {
  const before = (await api.getSalaryStructure(1)).current;
  const revised = await api.reviseSalary(1, {
    pay_type: "monthly", basic: 23000, allowances: 2000, ot_rate: 104, paid_by: "bank",
    effective_from_bs: `${monthKey(CURRENT)}-01`, reason: "Promotion",
  });
  assert.equal(revised.gross, 25000);
  assert.equal(revised.previous_gross, before.gross);
  const after = await api.getSalaryStructure(1);
  assert.equal(after.current.id, revised.id);
  assert.equal(after.history.length, 3);
  const ledger = await api.getLedger(1);
  assert.equal(ledger[0].rate, 25000);
});

test("photo tokens: resolve, upload, expire", async () => {
  const token = await api.createPhotoToken(3, "https://ttk.example");
  assert.ok(token.url.startsWith("https://ttk.example/people/photo/"));
  const info = await api.resolvePhotoToken(token.token);
  assert.equal(info.employee.id, 3);
  const employee = await api.uploadPhotoByToken(token.token, "data:image/jpeg;base64,AAAA");
  assert.equal(employee.photo_url, "data:image/jpeg;base64,AAAA");
  await assert.rejects(api.resolvePhotoToken("nope"), (e) => e.status === 410);
});

test("branch_id scopes the payments register and the salary report; department counts follow the branch", async () => {
  const range = rangeFor("last_month", NOW);
  const all = await api.listPayments({ ...range, type: "all" });
  const branches = new Set(all.rows.map((r) => r.employee.branch.id));
  assert.ok(branches.size >= 2, "sample payments span at least two branches");
  assert.equal(all.branch, null);
  const two = await api.listPayments({ ...range, type: "all", branch_id: 2 });
  assert.ok(two.rows.length > 0 && two.rows.length < all.rows.length);
  assert.ok(two.rows.every((r) => r.employee.branch.id === 2));
  assert.equal(two.branch.name, "Branch 2");
  assert.ok(two.totals.staff < all.totals.staff && two.totals.month_net < all.totals.month_net);
  assert.equal(two.by_department.reduce((s, d) => s + d.count, 0), two.rows.length);
  assert.ok(two.by_department.reduce((s, d) => s + d.count, 0) < all.by_department.reduce((s, d) => s + d.count, 0));
  await assert.rejects(api.listPayments({ ...range, type: "all", branch_id: 99 }), /branch/i);

  const report = await api.getSalaryReport(PREVIOUS);
  assert.equal(report.branch, null);
  const branchReport = await api.getSalaryReport(PREVIOUS, null, 2);
  assert.ok(branchReport.rows.length > 0 && branchReport.rows.length < report.rows.length);
  assert.ok(branchReport.rows.every((r) => r.employee.branch.id === 2));
  assert.equal(branchReport.all_staff, branchReport.rows.length);
  assert.equal(branchReport.by_department.reduce((s, d) => s + d.staff, 0), branchReport.rows.length);
  assert.ok(branchReport.by_department.reduce((s, d) => s + d.staff, 0) < report.by_department.reduce((s, d) => s + d.staff, 0));
  const both = await api.getSalaryReport(PREVIOUS, 2, 2);
  assert.ok(both.rows.every((r) => r.employee.branch.id === 2 && r.employee.department.id === 2));
  assert.equal(both.all_staff, branchReport.rows.length);
  assert.ok(both.trend.at(-1).net <= branchReport.trend.at(-1).net);
  await assert.rejects(api.getSalaryReport(PREVIOUS, null, 99), /branch/i);
});

test("salary report by_branch: one line per branch adding up to the totals; one line when a branch is chosen", async () => {
  const report = await api.getSalaryReport(PREVIOUS);
  assert.ok(report.by_branch.length >= 2, "sample employees span at least two branches");
  const names = report.by_branch.map((b) => b.branch.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  assert.equal(report.by_branch.reduce((s, b) => s + b.staff, 0), report.rows.length);
  assert.equal(report.by_branch.reduce((s, b) => s + b.net, 0), report.totals.net);
  assert.equal(report.by_branch.reduce((s, b) => s + b.due, 0), report.totals.due);
  assert.equal(report.by_branch.reduce((s, b) => s + b.paid, 0), report.totals.salary_paid + report.totals.advance_paid);
  // The department filter applies to the summary too.
  const kitchen = await api.getSalaryReport(PREVIOUS, 2);
  assert.equal(kitchen.by_branch.reduce((s, b) => s + b.staff, 0), kitchen.rows.length);
  const one = await api.getSalaryReport(PREVIOUS, null, 2);
  assert.equal(one.by_branch.length, 1);
  assert.equal(one.by_branch[0].branch.id, 2);
  assert.equal(one.by_branch[0].net, one.totals.net);
});
