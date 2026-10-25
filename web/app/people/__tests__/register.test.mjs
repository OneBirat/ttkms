import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as api from "../api.ts";
import { departmentPaymentCounts, displayRows, groupRowsByBranch, groupRowsByDepartment, groupTotals, isRegisterSort, sortRegisterRows } from "../_lib/register.ts";
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
  assert.deepEqual(sheets.map((s) => s.name), ["Payments", "By branch", "By department", "By employee", "Summary", "Sort & filter"]);
  const byDept = sheets[2];
  assert.deepEqual(byDept.rows[1].map((c) => c.v), ["Department", "Salary", "Advances", "Total", "Count"]);
  const deptRows = byDept.rows.slice(2, -1);
  assert.equal(deptRows.length, groupRowsByDepartment(all.rows).length);
  assert.equal(deptRows.reduce((s, r) => s + r[3].v, 0), all.rows.reduce((s, r) => s + r.payment.amount, 0));
  assert.equal(deptRows.reduce((s, r) => s + r[4].v, 0), all.rows.length);
  // The Payments sheet keeps its autofilter over the Department (D) and Branch (E) columns and follows the sort.
  assert.match(sheets[0].autoFilter, /^A4:L\d+$/);
  assert.deepEqual(sheets[0].rows[3].slice(3, 5).map((c) => c.v), ["Department", "Branch"]);
  const sheetRows = sheets[0].rows.slice(4, 4 + all.rows.length);
  const branchesThenDepts = sheetRows.map((r) => `${r[4]}|${r[3]}`);
  assert.deepEqual(branchesThenDepts, [...branchesThenDepts].sort((a, b) => a.localeCompare(b)));
  // A chosen department shows in the titles and the file name; the title always names the branch scope.
  const scopedSheets = registerWorkbook(input(scoped));
  assert.match(String(scopedSheets[0].rows[0][0].v), /Payment report · All branches · Store · /);
  assert.match(registerPdfHtml(input(scoped)), /<h1>Payment report · All branches · Store · /);
  assert.match(registerPdfHtml(input(all)), /<h1>Payment report · All branches · /);
  assert.doesNotMatch(registerPdfHtml(input(all)), /Payment report · All branches · Store/);
  assert.equal(registerFileName(range.from_bs, range.to_bs, "pdf", store), `Payment_report_Store_${range.from_bs}_to_${range.to_bs}.pdf`);
  assert.equal(registerFileName(range.from_bs, range.to_bs, "xlsx", null), `Payment_report_${range.from_bs}_to_${range.to_bs}.xlsx`);
  // Department sort in the PDF: one subtotal row per group, grand total at the bottom.
  const html = registerPdfHtml(input(all));
  // All branches + Sort = Department nests: one branch subtotal per branch, one department subtotal per (branch, department).
  const branchGroups = groupRowsByBranch(all.rows, true);
  assert.equal((html.match(/<tr class="brsub">/g) ?? []).length, branchGroups.length);
  assert.equal((html.match(/<tr class="sub">/g) ?? []).length, branchGroups.reduce((s, g) => s + g.departments.length, 0));
  assert.match(html, /Total paid · \d+ payments/);
  // A chosen branch: no By branch sheet, flat department groups, the branch in the title and file name.
  const two = await api.listPayments({ ...range, type: "all", branch_id: 2, sort: "department" });
  const twoSheets = registerWorkbook(input(two));
  assert.ok(!twoSheets.some((s) => s.name === "By branch"));
  assert.match(String(twoSheets[0].rows[0][0].v), /Payment report · Branch 2 · /);
  const twoHtml = registerPdfHtml(input(two));
  assert.equal((twoHtml.match(/<tr class="brsub">/g) ?? []).length, 0);
  assert.equal((twoHtml.match(/<tr class="sub">/g) ?? []).length, groupRowsByDepartment(two.rows).length);
  assert.equal(registerFileName(range.from_bs, range.to_bs, "pdf", null, two.branch), `Payment_report_Branch_2_${range.from_bs}_to_${range.to_bs}.pdf`);
});

test("branch grouping: Sort = Branch subtotals add up; All branches + Department nests with totals at both levels", async () => {
  const byBranch = await api.listPayments({ ...range, type: "all", sort: "branch" });
  const names = byBranch.rows.map((r) => r.employee.branch.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  const groups = groupRowsByBranch(byBranch.rows);
  assert.ok(groups.length >= 2, "payments span at least two branches");
  const grand = groupTotals(byBranch.rows);
  assert.equal(groups.reduce((s, g) => s + g.total, 0), grand.total);
  assert.equal(groups.reduce((s, g) => s + g.salary, 0), grand.salary);
  assert.equal(groups.reduce((s, g) => s + g.advances, 0), grand.advances);
  for (const g of groups) assert.ok(g.rows.every((r) => r.employee.branch.id === g.branch.id) && g.departments === null);
  // by_branch from the API matches the grouping.
  assert.deepEqual(byBranch.by_branch.map((b) => [b.branch.id, b.count, b.total]), groups.map((g) => [g.branch.id, g.rows.length, g.total]));
  const shown = displayRows(byBranch.rows, "branch", true);
  assert.equal(shown.filter((d) => d.kind === "branch").length, groups.length);
  assert.equal(shown.filter((d) => d.kind === "branchSubtotal").length, groups.length);
  assert.equal(shown.filter((d) => d.kind === "group").length, 0);

  const nested = await api.listPayments({ ...range, type: "all", sort: "department" });
  const tree = groupRowsByBranch(nested.rows, true);
  for (const g of tree) {
    assert.equal(g.departments.reduce((s, d) => s + d.total, 0), g.total);
    const deptNames = g.departments.map((d) => d.department?.name ?? "");
    assert.deepEqual(deptNames, [...deptNames].sort((a, b) => a.localeCompare(b)));
  }
  assert.equal(tree.reduce((s, g) => s + g.total, 0), groupTotals(nested.rows).total);
  const nestedShown = displayRows(nested.rows, "department", true);
  assert.equal(nestedShown.filter((d) => d.kind === "branch").length, tree.length);
  assert.equal(nestedShown.filter((d) => d.kind === "subtotal").length, tree.reduce((s, g) => s + g.departments.length, 0));
  assert.equal(nestedShown.filter((d) => d.kind === "row").length, nested.rows.length);
  assert.equal(nestedShown.at(-1).kind, "branchSubtotal");
  // With a branch chosen the same sort is flat department groups.
  const one = await api.listPayments({ ...range, type: "all", branch_id: 1, sort: "department" });
  assert.ok(displayRows(one.rows, "department", false).every((d) => d.kind !== "branch"));
});
