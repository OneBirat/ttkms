import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as api from "../api.ts";
import { mockAttendance } from "../mockData.ts";

const ASHWIN = { bs_year: 2083, bs_month: 6 };

beforeEach(async () => {
  await api.resetMockData();
});

test("seed: 25 employees, codes E-001…, both pay types, next code E-026", async () => {
  const employees = await api.listEmployees();
  assert.equal(employees.length, 25);
  assert.equal(employees[0].code, "E-001");
  assert.equal(await api.nextEmployeeCode(), "E-026");
  const structures = await Promise.all(employees.map((e) => api.getSalaryStructure(e.id)));
  const types = new Set(structures.map((s) => s.current.pay_type));
  assert.deepEqual([...types].sort(), ["daily", "monthly"]);
});

test("mock attendance has the MonthSummary shape and consistent paid days", () => {
  const s = mockAttendance(1, ASHWIN);
  for (const key of ["days_in_month", "present", "late", "half_days", "leave", "absent", "weekly_off", "paid_days"]) {
    assert.ok(key in s, key);
  }
  assert.equal(s.paid_days, s.days_in_month - s.absent - s.half_days * 0.5);
  assert.ok(s.present <= s.days_in_month - s.weekly_off);
});

test("current run is a draft with paid and pending slips; earlier runs are paid", async () => {
  const months = await api.listPayrollMonths();
  assert.equal(months.length, 6);
  assert.deepEqual(months[0], ASHWIN);
  const run = await api.getRun(ASHWIN);
  assert.equal(run.status, "draft");
  assert.ok(run.payslips.some((p) => p.status === "pending"));
  assert.ok(run.payslips.some((p) => p.status === "paid"));
  const older = await api.getRun(months[1]);
  assert.equal(older.status, "paid");
  assert.ok(older.payslips.every((p) => p.status === "paid" && p.paid_on));
});

test("ledger numbers follow the rules", async () => {
  const ledger = await api.getLedger(1);
  assert.equal(ledger.length, 6);
  for (const slip of ledger) {
    assert.equal(slip.net_pay, slip.gross - slip.absence_deduction - slip.advance_recovered - slip.tds);
    assert.equal(slip.paid_days + slip.unpaid_days, slip.days_in_month);
  }
});

test("createEmployee assigns the next code, rejects duplicate phone and username", async () => {
  const branches = await api.listBranches();
  const departments = await api.listDepartments();
  const base = {
    full_name: "Sarita Basnet",
    phone: "9841000111",
    branch_id: branches[0].id,
    department_id: departments[0].id,
    designation: "Cashier",
    pay_type: "monthly",
    amount: 21000,
    paid_by: "bank",
    login: { username: "sarita.b", role: "staff" },
  };
  const created = await api.createEmployee(base);
  assert.equal(created.employee.code, "E-026");
  assert.equal(created.employee.login.username, "sarita.b");
  assert.ok(created.one_time_password);
  // The new employee joins the draft run with a pending payslip.
  const run = await api.getRun(ASHWIN);
  assert.ok(run.payslips.some((p) => p.employee_id === created.employee.id && p.status === "pending"));

  const first = await api.getEmployee(1);
  await assert.rejects(
    api.createEmployee({ ...base, phone: first.phone, login: null }),
    (err) => err.status === 409 && err.field === "phone",
  );
  await assert.rejects(
    api.createEmployee({ ...base, phone: "9800000000", login: { username: "anita.g", role: "staff" } }),
    (err) => err.status === 409 && err.field === "username",
  );
  await assert.rejects(
    api.createEmployee({ ...base, phone: "9800000001", login: null, full_name: " " }),
    (err) => err.field === "full_name",
  );
});

test("giveAdvance recovers from the pending payslip and settles when paid", async () => {
  const employee = (await api.listEmployees()).find((e) => e.id === 2); // daily wage, pending in the draft run
  const before = (await api.getLedger(employee.id))[0];
  assert.equal(before.status, "pending");
  assert.equal(before.advance_recovered, 0);

  const advance = await api.giveAdvance(employee.id, { amount: 3000, given_on_bs: "2083-06-20", monthly_recovery: 1000 });
  assert.equal(advance.outstanding, 3000);

  const after = (await api.getLedger(employee.id))[0];
  assert.equal(after.advance_recovered, 1000);
  assert.equal(after.net_pay, before.net_pay - 1000);

  const paid = await api.payEmployee(employee.id, ASHWIN);
  assert.equal(paid.status, "paid");
  assert.ok(paid.paid_on.bs);
  const [stored] = await api.listAdvances(employee.id);
  assert.equal(stored.outstanding, 2000);
  assert.equal(stored.recoveries.length, 1);
  await assert.rejects(api.payEmployee(employee.id, ASHWIN), (err) => err.status === 409);
});

test("giveAdvance validation", async () => {
  await assert.rejects(api.giveAdvance(1, { amount: 0, given_on_bs: "2083-06-01", monthly_recovery: 100 }), (e) => e.field === "amount");
  await assert.rejects(api.giveAdvance(1, { amount: 1000, given_on_bs: "2083-06-01", monthly_recovery: 2000 }), (e) => e.field === "monthly_recovery");
  await assert.rejects(api.giveAdvance(1, { amount: 1000, given_on_bs: "nope", monthly_recovery: 500 }), (e) => e.field === "given_on_bs");
});

test("reviseSalary changes pending payslips only", async () => {
  const pending = (await api.getRun(ASHWIN)).payslips.find((p) => p.status === "pending" && p.pay_type === "monthly");
  const paidBefore = (await api.getRun(ASHWIN)).payslips.find((p) => p.status === "paid");
  await api.reviseSalary(pending.employee_id, { pay_type: "monthly", amount: pending.rate + 1000, paid_by: "bank", effective_from_bs: "2083-06-01" });
  const structure = await api.getSalaryStructure(pending.employee_id);
  assert.equal(structure.current.amount, pending.rate + 1000);
  assert.equal(structure.current.previous_amount, pending.rate);
  const run = await api.getRun(ASHWIN);
  assert.equal(run.payslips.find((p) => p.id === pending.id).gross, pending.rate + 1000);
  assert.equal(run.payslips.find((p) => p.id === paidBefore.id).gross, paidBefore.gross);
});

test("markPendingPaid settles everyone (or one department) and closes the run", async () => {
  const departments = await api.listDepartments();
  const store = departments[0];
  const count = await api.markPendingPaid(ASHWIN, store.id);
  assert.ok(count >= 1);
  let report = await api.getSalaryReport(ASHWIN, store.id);
  assert.equal(report.totals.pending_count, 0);
  report = await api.getSalaryReport(ASHWIN);
  assert.ok(report.totals.pending_count > 0);
  await api.markPendingPaid(ASHWIN);
  const run = await api.getRun(ASHWIN);
  assert.equal(run.status, "paid");
});

test("salary report totals, department bars and 6-month trend", async () => {
  const report = await api.getSalaryReport(ASHWIN);
  assert.equal(report.rows.length, 25);
  assert.equal(report.totals.net_pay, report.rows.reduce((s, r) => s + r.payslip.net_pay, 0));
  assert.equal(report.trend.length, 6);
  assert.deepEqual(report.trend[5].month, ASHWIN);
  assert.equal(report.by_department.length, 5);
  const filtered = await api.getSalaryReport(ASHWIN, 2);
  assert.ok(filtered.rows.every((r) => r.employee.department.id === 2));
  assert.equal(filtered.trend[5].net_pay, filtered.totals.net_pay);
});

test("photo tokens expire and update the employee photo", async () => {
  const token = await api.createPhotoToken(1, "http://localhost:3003");
  assert.match(token.url, /^http:\/\/localhost:3003\/payroll\/photo\/[0-9a-f]{32}$/);
  const info = await api.resolvePhotoToken(token.token);
  assert.equal(info.employee.id, 1);
  const updated = await api.uploadPhotoByToken(token.token, "data:image/jpeg;base64,xx");
  assert.equal(updated.photo_url, "data:image/jpeg;base64,xx");
  await assert.rejects(api.resolvePhotoToken("missing"), (e) => e.status === 410);
  await api.setEmployeePhoto(1, null);
  assert.equal((await api.getEmployee(1)).photo_url, null);
});

test("createBranch / createDepartment reject duplicates", async () => {
  const branch = await api.createBranch("Pokhara");
  assert.equal(branch.name, "Pokhara");
  await assert.rejects(api.createBranch("main  branch"), (e) => e.status === 409);
  await assert.rejects(api.createDepartment("KITCHEN"), (e) => e.status === 409);
});
