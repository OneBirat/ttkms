import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as api from "../api.ts";
import { departmentPaymentCounts, displayRows, groupRowsByDepartment, groupTotals, isRegisterSort, sortRegisterRows } from "../_lib/register.ts";
import { registerFileName, registerPdfHtml, registerWorkbook } from "../_lib/exports.ts";
import { rangeFor } from "../_lib/months.ts";

const NOW = new Date("2026-10-24T06:00:00Z");

beforeEach(async () => {
  await api.resetMockData(NOW);
});

const range = rangeFor("last_month", NOW);

test("sort keys: date newest first, department A-Z, employee A-Z, amount high to low", async () => {
  const { rows } = await api.listPayments({ ...range, type: "all" });
  assert.ok(rows.length > 10);
  const dates = sortRegisterRows(rows, "date").map((r) => r.payment.date.bs);
  assert.deepEqual(dates, [...dates].sort().reverse());
  const depts = sortRegisterRows(rows, "department").map((r) => r.employee.department?.name ?? "");
  assert.deepEqual(depts, [...depts].sort((a, b) => a.localeCompare(b)));
  const names = sortRegisterRows(rows, "employee").map((r) => r.employee.full_name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  const amounts = sortRegisterRows(rows, "amount").map((r) => r.payment.amount);
  assert.deepEqual(amounts, [...amounts].sort((a, b) => b - a));
  assert.ok(isRegisterSort("department") && !isRegisterSort("dept") && !isRegisterSort(null));
});

test("department groups: subtotals add up to the grand total; display rows wrap each group", async () => {
  const { rows } = await api.listPayments({ ...range, type: "all" });
  const groups = groupRowsByDepartment(sortRegisterRows(rows, "department"));
  assert.ok(groups.length >= 2);
  const grand = groupTotals(rows);
  assert.equal(grand.total, rows.reduce((s, r) => s + r.payment.amount, 0));
  assert.equal(groups.reduce((s, g) => s + g.salary, 0), grand.salary);
  assert.equal(groups.reduce((s, g) => s + g.advances, 0), grand.advances);
  assert.equal(groups.reduce((s, g) => s + g.total, 0), grand.total);
  for (const g of groups) {
    assert.equal(g.total, g.salary + g.advances);
    assert.ok(g.rows.every((r) => (r.employee.department?.id ?? null) === (g.department?.id ?? null)));
  }
  const shown = displayRows(sortRegisterRows(rows, "department"), "department");
  assert.equal(shown.filter((d) => d.kind === "group").length, groups.length);
  assert.equal(shown.filter((d) => d.kind === "subtotal").length, groups.length);
  assert.equal(shown.filter((d) => d.kind === "row").length, rows.length);
  assert.equal(shown[0].kind, "group");
  assert.equal(shown.at(-1).kind, "subtotal");
  assert.ok(displayRows(rows, "date").every((d) => d.kind === "row"));
});

test("chips count payments per department for the range; the API filters rows and tiles by department", async () => {
  const all = await api.listPayments({ ...range, type: "all" });
  const departments = all.by_department.map((d) => d.department).filter(Boolean);
  const counts = departmentPaymentCounts(all.rows, departments);
  assert.equal(counts.reduce((s, c) => s + c.count, 0), all.rows.filter((r) => r.employee.department).length);
  const store = departments.find((d) => d.name === "Store");
  const only = await api.listPayments({ ...range, type: "all", department_id: store.id, sort: "amount" });
  assert.ok(only.rows.length > 0 && only.rows.every((r) => r.employee.department?.id === store.id));
  assert.equal(only.rows.length, counts.find((c) => c.department.id === store.id).count);
  assert.deepEqual(only.department, store);
  assert.equal(only.sort, "amount");
  assert.deepEqual(only.rows.map((r) => r.payment.amount), [...only.rows.map((r) => r.payment.amount)].sort((a, b) => b - a));
  // Tiles follow the department: fewer staff, smaller net payroll, due never above the whole company's.
  assert.ok(only.totals.staff < all.totals.staff);
  assert.ok(only.totals.month_net < all.totals.month_net);
  assert.ok(only.totals.due <= all.totals.due);
  assert.equal(only.by_employee.length, only.totals.staff);
  // by_department covers the whole range (not the chosen department) so the chips keep their counts.
  assert.deepEqual(only.by_department, all.by_department);
  assert.equal(all.by_department.reduce((s, d) => s + d.count, 0), all.rows.length);
  assert.ok(all.by_department.every((d) => d.total === d.salary + d.advances));
  await assert.rejects(api.listPayments({ ...range, type: "all", department_id: 999 }), /department/i);
});

test("exports carry the range, department and sort: By department sheet, PDF title, file name", async () => {
  const all = await api.listPayments({ ...range, type: "all", sort: "department" });
  const store = all.by_department.find((d) => d.department?.name === "Store").department;
  const scoped = await api.listPayments({ ...range, type: "all", department_id: store.id, sort: "department" });
  const input = (register) => ({ register, rows: register.rows, branch: "All branches", generatedBy: "Test", previousMonth: false });
  const sheets = registerWorkbook(input(all));
  assert.deepEqual(sheets.map((s) => s.name), ["Payments", "By department", "By employee", "Summary", "Sort & filter"]);
  const byDept = sheets[1];
  assert.deepEqual(byDept.rows[1].map((c) => c.v), ["Department", "Salary", "Advances", "Total", "Count"]);
  const deptRows = byDept.rows.slice(2, -1);
  assert.equal(deptRows.length, groupRowsByDepartment(all.rows).length);
  assert.equal(deptRows.reduce((s, r) => s + r[3].v, 0), all.rows.reduce((s, r) => s + r.payment.amount, 0));
  assert.equal(deptRows.reduce((s, r) => s + r[4].v, 0), all.rows.length);
  // The Payments sheet keeps its autofilter over the Department column (D) and follows the sort.
  assert.match(sheets[0].autoFilter, /^A4:K\d+$/);
  const names = sheets[0].rows.slice(4, 4 + all.rows.length).map((r) => r[3]);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  // A chosen department shows in the titles and the file name.
  const scopedSheets = registerWorkbook(input(scoped));
  assert.match(String(scopedSheets[0].rows[0][0].v), /Payment report · Store · /);
  assert.match(registerPdfHtml(input(scoped)), /<h1>Payment report · Store · /);
  assert.doesNotMatch(registerPdfHtml(input(all)), /Payment report · Store/);
  assert.equal(registerFileName(range.from_bs, range.to_bs, "pdf", store), `Payment_report_Store_${range.from_bs}_to_${range.to_bs}.pdf`);
  assert.equal(registerFileName(range.from_bs, range.to_bs, "xlsx", null), `Payment_report_${range.from_bs}_to_${range.to_bs}.xlsx`);
  // Department sort in the PDF: one subtotal row per group, grand total at the bottom.
  const html = registerPdfHtml(input(all));
  assert.equal((html.match(/<tr class="sub">/g) ?? []).length, groupRowsByDepartment(all.rows).length);
  assert.match(html, /Total paid · \d+ payments/);
});
