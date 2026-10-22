import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatDays,
  formatDeduction,
  formatLakh,
  formatPaidDays,
  formatRs,
  groupByDepartment,
  initials,
  matchesEmployee,
  normalizePhone,
  paginate,
  percentChange,
  sortRows,
  suggestUsername,
  toCsv,
  totalsFor,
} from "../helpers.ts";
import {
  addMonths,
  compareMonths,
  formatAd,
  formatBsLong,
  formatBsShort,
  mockBsToAd,
  monthKey,
  monthLabel,
  parseMonthKey,
} from "../calendar.ts";

test("money is Rs with en-IN grouping", () => {
  assert.equal(formatRs(123456), "Rs 1,23,456");
  assert.equal(formatRs(1466.6), "Rs 1,467");
  assert.equal(formatRs(0), "Rs 0");
  assert.equal(formatDeduction(2500), "−2,500");
  assert.equal(formatDeduction(0), "0");
  assert.equal(formatLakh(571250), "5.71L");
});

test("paid days formatting", () => {
  assert.equal(formatPaidDays(29, 30), "29 / 30");
  assert.equal(formatPaidDays(29.5, 30), "29.5 / 30");
  assert.equal(formatDays(23.5), "23.5");
});

test("initials", () => {
  assert.equal(initials("Anita Gurung"), "AG");
  assert.equal(initials("Ramesh K.C."), "RK");
  assert.equal(initials("Sunita B.K."), "SB");
  assert.equal(initials("Dil Bahadur Rai"), "DR");
  assert.equal(initials("Madonna"), "MA");
  assert.equal(initials("  "), "?");
});

test("search matches name or code, case-insensitive", () => {
  const e = { full_name: "Anita Gurung", code: "E-001" };
  assert.ok(matchesEmployee(e, "anita"));
  assert.ok(matchesEmployee(e, "E-001"));
  assert.ok(matchesEmployee(e, "001"));
  assert.ok(matchesEmployee(e, "e1") === false);
  assert.ok(matchesEmployee(e, ""));
  assert.equal(matchesEmployee(e, "ramesh"), false);
});

test("phone and username helpers", () => {
  assert.equal(normalizePhone("98-41 234 567"), "9841234567");
  assert.equal(suggestUsername("Sarita Basnet"), "sarita.b");
  assert.equal(suggestUsername("Ramesh K.C."), "ramesh.k");
  assert.equal(suggestUsername("Madonna"), "madonna");
});

test("groupByDepartment keeps department order and sorts names", () => {
  const depts = [{ id: 1, name: "Store", is_active: true }, { id: 2, name: "Kitchen", is_active: true }];
  const emp = (id, name, dept) => ({ id, full_name: name, department: dept ? { id: dept } : null });
  const groups = groupByDepartment([emp(1, "Zed", 2), emp(2, "Amy", 2), emp(3, "Bob", 1), emp(4, "No Dept", null)], depts);
  assert.deepEqual(groups.map((g) => g.department?.name ?? null), ["Store", "Kitchen", null]);
  assert.deepEqual(groups[1].employees.map((e) => e.full_name), ["Amy", "Zed"]);
});

test("sortRows implements the four report sorts", () => {
  const depts = [{ id: 1, name: "Store" }, { id: 2, name: "Kitchen" }];
  const row = (name, dept, net, unpaid) => ({
    employee: { full_name: name, department: { id: dept } },
    payslip: { net_pay: net, unpaid_days: unpaid },
  });
  const rows = [row("Bikash", 2, 26000, 0), row("Anita", 1, 20000, 2), row("Ramesh", 1, 15000, 1)];
  assert.deepEqual(sortRows(rows, "dept", depts).map((r) => r.employee.full_name), ["Anita", "Ramesh", "Bikash"]);
  assert.deepEqual(sortRows(rows, "net", depts).map((r) => r.employee.full_name), ["Bikash", "Anita", "Ramesh"]);
  assert.deepEqual(sortRows(rows, "unpaid", depts).map((r) => r.employee.full_name), ["Anita", "Ramesh", "Bikash"]);
  assert.deepEqual(sortRows(rows, "name", depts).map((r) => r.employee.full_name), ["Anita", "Bikash", "Ramesh"]);
});

test("totalsFor sums the sheet", () => {
  const slip = (over) => ({ gross: 100, absence_deduction: 10, unpaid_days: 1, advance_recovered: 5, net_pay: 85, status: "paid", ...over });
  const totals = totalsFor([slip({}), slip({ status: "pending" })], 777);
  assert.equal(totals.staff, 2);
  assert.equal(totals.gross, 200);
  assert.equal(totals.absence_deduction, 20);
  assert.equal(totals.unpaid_days, 2);
  assert.equal(totals.advance_recovered, 10);
  assert.equal(totals.advance_outstanding, 777);
  assert.equal(totals.net_pay, 170);
  assert.equal(totals.paid_count, 1);
  assert.equal(totals.pending_count, 1);
});

test("paginate at 25 rows", () => {
  const items = Array.from({ length: 60 }, (_, i) => i);
  assert.equal(paginate(items, 1, 25).pages, 3);
  assert.deepEqual(paginate(items, 3, 25).items, items.slice(50));
  assert.equal(paginate(items, 9, 25).page, 3);
  assert.equal(paginate([], 1, 25).pages, 1);
});

test("percentChange", () => {
  assert.equal(percentChange(90, 100), 11);
  assert.equal(percentChange(0, 100), null);
});

test("toCsv quotes and uses a BOM", () => {
  const csv = toCsv(["Name", "Net"], [["K.C., Ramesh", 1500], ['He said "hi"', 0]]);
  assert.equal(csv, '﻿Name,Net\r\n"K.C., Ramesh",1500\r\n"He said ""hi""",0\r\n');
});

test("mock calendar helpers", () => {
  assert.equal(monthKey({ bs_year: 2083, bs_month: 7 }), "2083-07");
  assert.deepEqual(parseMonthKey("2083-07"), { bs_year: 2083, bs_month: 7 });
  assert.equal(parseMonthKey("2083-13"), null);
  assert.equal(monthLabel({ bs_year: 2083, bs_month: 6 }), "Ashwin 2083");
  assert.deepEqual(addMonths({ bs_year: 2083, bs_month: 1 }, -1), { bs_year: 2082, bs_month: 12 });
  assert.deepEqual(addMonths({ bs_year: 2083, bs_month: 12 }, 1), { bs_year: 2084, bs_month: 1 });
  assert.ok(compareMonths({ bs_year: 2083, bs_month: 1 }, { bs_year: 2082, bs_month: 12 }) > 0);
  assert.equal(mockBsToAd("2083-01-01"), "2026-04-14");
  assert.equal(mockBsToAd("2083-07-06"), "2026-10-23");
  assert.equal(formatBsLong("2083-07-06"), "Kartik 6, 2083");
  assert.equal(formatBsShort("2083-07-02"), "07-02");
  assert.equal(formatAd("2026-10-23"), "23 Oct 2026");
});
