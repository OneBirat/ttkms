import { test } from "node:test";
import assert from "node:assert/strict";
import {
  barcodeFor,
  employeeCode,
  formatAddition,
  formatDeduction,
  formatPaidDays,
  formatRs,
  groupByDepartment,
  initials,
  matchesEmployee,
  normalizePhone,
  paginate,
  percentChange,
  sortEmployees,
  sortRows,
  statusPill,
  suggestUsername,
  toCsv,
  totalsFor,
} from "../_lib/helpers.ts";
import { adToBs, bsToAd, formatBs, formatDateBoth, isValidBs, monthDays } from "@/lib/bs";
import { addMonths, compareMonths, daysInMonth, monthKey, monthLabel, parseMonthKey } from "../_lib/months.ts";

const DEPTS = [
  { id: 1, name: "Store", employee_count: 0, active_employee_count: 0 },
  { id: 2, name: "Kitchen", employee_count: 0, active_employee_count: 0 },
];

function emp(id, name, dept, designation = "Helper") {
  return {
    id,
    code: employeeCode(id),
    barcode: barcodeFor(employeeCode(id)),
    full_name: name,
    phone: null,
    phone_alt: null,
    address: null,
    branch: { id: 1, name: "Main branch", is_active: true },
    department: dept ? DEPTS.find((d) => d.id === dept) : null,
    designation,
    active: true,
    joined: { bs: "2080-01-01", ad: "2023-04-14" },
    photo_url: null,
    login: null,
    created_at: "2080-01-01",
  };
}

function ledger(overrides) {
  return {
    attendance: { days_in_month: 30, present: 26, overtime_days: 0, overtime_hours: 0, absent: 0, weekly_off: 4, paid_days: 30 },
    paid_days: 30,
    earnings: 0,
    absence_deduction: 0,
    overtime_pay: 0,
    advance_paid: 0,
    salary_paid: 0,
    tds: 0,
    net: 0,
    due: 0,
    status: "pending",
    ...overrides,
  };
}

test("money is Rs with en-IN grouping", () => {
  assert.equal(formatRs(123456), "Rs 1,23,456");
  assert.equal(formatRs(999), "Rs 999");
  assert.equal(formatDeduction(2500), "−2,500");
  assert.equal(formatDeduction(0), "0");
  assert.equal(formatAddition(750), "+750");
  assert.equal(formatPaidDays(29, 30), "29 / 30");
});

test("codes and barcodes", () => {
  assert.equal(employeeCode(25), "E-025");
  assert.equal(barcodeFor("E-025"), "TTK-E025");
  assert.equal(barcodeFor("E-001"), "TTK-E001");
});

test("status pill tones", () => {
  assert.equal(statusPill("paid"), "paid");
  assert.equal(statusPill("part_paid"), "pending");
  assert.equal(statusPill("pending"), "neutral");
});

test("initials", () => {
  assert.equal(initials("Anita Gurung"), "AG");
  assert.equal(initials("Ramesh K.C."), "RK");
  assert.equal(initials("Hari Bahadur Bk"), "HB");
  assert.equal(initials("Sita"), "SI");
});

test("search matches name, code or barcode, case-insensitive", () => {
  const e = emp(7, "Sabina Magar", 2);
  assert.ok(matchesEmployee(e, "sab"));
  assert.ok(matchesEmployee(e, "E-007"));
  assert.ok(matchesEmployee(e, "7"));
  assert.ok(matchesEmployee(e, "ttk-e007"));
  assert.ok(!matchesEmployee(e, "anita"));
});

test("phone and username helpers", () => {
  assert.equal(normalizePhone("+977 98-123 456"), "97798123456");
  assert.equal(suggestUsername("Sarita Basnet"), "sarita.b");
  assert.equal(suggestUsername("Sita"), "sita");
});

test("sortEmployees: name, employee ID, designation", () => {
  const list = [emp(2, "Zara", 1, "Cook"), emp(1, "Anil", 1, "Helper"), emp(3, "Mina", 1, "Cook")];
  assert.deepEqual(sortEmployees(list, "name").map((e) => e.id), [1, 3, 2]);
  assert.deepEqual(sortEmployees(list, "code").map((e) => e.id), [1, 2, 3]);
  assert.deepEqual(sortEmployees(list, "designation").map((e) => e.id), [3, 2, 1]);
});

test("groupByDepartment keeps department order, sorts inside, 'no department' last", () => {
  const groups = groupByDepartment([emp(1, "Zed", 2), emp(2, "Amy", 2), emp(3, "Bob", 1), emp(4, "Cat", null)], DEPTS);
  assert.deepEqual(groups.map((g) => g.department?.name ?? null), ["Store", "Kitchen", null]);
  assert.deepEqual(groups[1].employees.map((e) => e.full_name), ["Amy", "Zed"]);
});

test("sortRows implements the report sorts", () => {
  const rows = [
    { employee: emp(1, "Bina", 2), ledger: ledger({ net: 100, due: 100, paid_days: 28 }) },
    { employee: emp(2, "Anil", 1), ledger: ledger({ net: 300, due: 0, paid_days: 30 }) },
    { employee: emp(3, "Cira", 1), ledger: ledger({ net: 200, due: 50, paid_days: 29 }) },
  ];
  assert.deepEqual(sortRows(rows, "dept", DEPTS).map((r) => r.employee.id), [2, 3, 1]);
  assert.deepEqual(sortRows(rows, "name", DEPTS).map((r) => r.employee.id), [2, 1, 3]);
  assert.deepEqual(sortRows(rows, "net", DEPTS).map((r) => r.employee.id), [2, 3, 1]);
  assert.deepEqual(sortRows(rows, "due", DEPTS).map((r) => r.employee.id), [1, 3, 2]);
  assert.deepEqual(sortRows(rows, "paid_days", DEPTS).map((r) => r.employee.id), [1, 3, 2]);
});

test("totalsFor sums the sheet and counts statuses", () => {
  const t = totalsFor([
    ledger({ earnings: 20000, absence_deduction: 1000, net: 19000, advance_paid: 1500, salary_paid: 17500, due: 0, status: "paid" }),
    ledger({ earnings: 15000, net: 15000, advance_paid: 1000, due: 14000, status: "part_paid" }),
    ledger({ earnings: 18000, net: 18000, due: 18000, status: "pending" }),
  ]);
  assert.equal(t.staff, 3);
  assert.equal(t.gross, 53000);
  assert.equal(t.absence_deduction, 1000);
  assert.equal(t.advance_paid, 2500);
  assert.equal(t.net, 52000);
  assert.equal(t.due, 32000);
  assert.deepEqual([t.paid_count, t.part_paid_count, t.pending_count], [1, 1, 1]);
});

test("paginate at 25 rows", () => {
  const items = Array.from({ length: 60 }, (_, i) => i);
  assert.equal(paginate(items, 1, 25).pages, 3);
  assert.deepEqual(paginate(items, 3, 25).items, items.slice(50));
  assert.equal(paginate(items, 9, 25).page, 3);
});

test("percentChange", () => {
  assert.equal(percentChange(100, 110), 10);
  assert.equal(percentChange(0, 10), null);
});

test("toCsv quotes and uses a BOM", () => {
  const csv = toCsv(["a", "b"], [["x,y", 'q"r'], [1, 2]]);
  assert.ok(csv.startsWith("﻿"));
  assert.ok(csv.includes('"x,y","q""r"'));
});

test("BS calendar: real conversions, month lengths and Saturdays", () => {
  assert.deepEqual(adToBs("2026-10-24"), { year: 2083, month: 7, day: 7 });
  assert.equal(bsToAd("2083-07-07"), "2026-10-24");
  assert.equal(bsToAd(`2083-07-01`), "2026-10-18");
  assert.equal(daysInMonth({ bs_year: 2083, bs_month: 3 }), 32);
  assert.equal(monthDays(2083, 7).filter((d) => d.weekday === 6).length, 4);
  assert.ok(isValidBs("2083-03-32"));
  assert.ok(!isValidBs("2083-07-31"));
  assert.ok(!isValidBs("nope"));
});

test("month helpers", () => {
  const m = { bs_year: 2083, bs_month: 7 };
  assert.equal(monthKey(m), "2083-07");
  assert.deepEqual(parseMonthKey("2083-07"), m);
  assert.equal(parseMonthKey("2083-13"), null);
  assert.equal(monthLabel(m), "Kartik 2083");
  assert.deepEqual(addMonths(m, -7), { bs_year: 2082, bs_month: 12 });
  assert.ok(compareMonths(m, addMonths(m, 1)) < 0);
  assert.equal(formatBs("2083-07-07"), "Kartik 7, 2083");
  assert.equal(formatDateBoth("2083-07-07"), "Kartik 7, 2083 · 24 Oct 2026");
});
