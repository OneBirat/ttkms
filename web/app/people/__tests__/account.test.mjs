import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { monthDays } from "@/lib/bs";
import {
  LIST_COLLAPSED_KEY,
  attendanceReportHref,
  branchStaff,
  calendarBounds,
  calendarChips,
  calendarWeeks,
  lastPayments,
  readCollapsed,
  staffGroups,
  stepMonth,
  writeCollapsed,
} from "../_lib/account.ts";
import { ACCOUNT_TABS, isAccountTab } from "../_lib/account.ts";
import { LastPaymentsCard } from "../_components/LastPaymentsCard.tsx";

const main = { id: 1, name: "Main branch", is_active: true };
const two = { id: 2, name: "Branch 2", is_active: true };
const store = { id: 1, name: "Store" };
const kitchen = { id: 2, name: "Kitchen" };
const emp = (id, name, branch, department) => ({ id, code: `E-00${id}`, full_name: name, branch, department, designation: null, active: true, photo_url: null });

test("side list: only this employee's branch, own department first", () => {
  const all = [emp(1, "Anita", main, store), emp(2, "Bikash", main, kitchen), emp(3, "Mina", two, kitchen), emp(4, "Ram", main, kitchen)];
  const staff = branchStaff(all, 1);
  assert.deepEqual(staff.map((e) => e.full_name), ["Anita", "Bikash", "Ram"]);
  const groups = staffGroups(staff, [store, kitchen], "name", kitchen.id);
  assert.deepEqual(groups.map((g) => g.department.name), ["Kitchen", "Store"]);
  assert.deepEqual(groups[0].employees.map((e) => e.full_name), ["Bikash", "Ram"]);
});

test("collapsed state persists in localStorage and survives a broken storage", () => {
  const data = new Map();
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  assert.equal(readCollapsed(storage), false);
  writeCollapsed(true, storage);
  assert.equal(data.get(LIST_COLLAPSED_KEY), "1");
  assert.equal(readCollapsed(storage), true);
  writeCollapsed(false, storage);
  assert.equal(readCollapsed(storage), false);
  const broken = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceeded");
    },
  };
  assert.equal(readCollapsed(broken), false);
  assert.doesNotThrow(() => writeCollapsed(true, broken));
  assert.equal(readCollapsed(undefined), false);
});

test("tabs: Overview · Salary · Ledger · Documents (no Attendance)", () => {
  assert.deepEqual(ACCOUNT_TABS.map((t) => t.label), ["Overview", "Salary", "Ledger", "Documents"]);
  assert.equal(isAccountTab("attendance"), false);
});

// Kartik 2083 with a few marks; "today" is Kartik 15, the employee joined on Kartik 3.
const KARTIK = monthDays(2083, 7);
const marks = { 3: ["P", 0], 4: ["O", 2], 5: ["A", 0], 10: ["P", 0], 15: ["P", 0], 20: ["P", 0] };
const days = KARTIK.map((d) => {
  const [status, ot] = marks[d.day] ?? [d.weekday === 6 ? "W" : "N", 0];
  return { bs_date: d.bs, bs_day: d.day, ad_date: d.ad, weekday: d.weekday, status, ot_hours: ot };
});
// A Saturday before joining comes back "W" from nobody (server sends N), but make sure we blank it anyway.
days[0] = { ...days[0], status: days[0].weekday === 6 ? "W" : "P" };

test("calendar: Sun-Sat weeks of the BS month, future and before-joining days blank, today flagged", () => {
  const weeks = calendarWeeks(days, "2083-07-15", "2083-07-03");
  assert.ok(weeks.every((w) => w.length === 7));
  const flat = weeks.flat();
  // Leading padding = weekday of the 1st.
  assert.equal(flat.findIndex((d) => d !== null), KARTIK[0].weekday);
  assert.equal(flat.filter(Boolean).length, KARTIK.length);
  const byDay = new Map(flat.filter(Boolean).map((d) => [d.bs_day, d]));
  assert.equal(byDay.get(1).mark, null, "before joining");
  assert.equal(byDay.get(3).mark, "P");
  assert.equal(byDay.get(4).mark, "O");
  assert.equal(byDay.get(4).ot_hours, 2);
  assert.equal(byDay.get(5).mark, "A");
  assert.equal(byDay.get(20).mark, null, "future");
  assert.ok(byDay.get(15).today && !byDay.get(14).today);
  // Saturdays: in the Saturday column, W when past, blank in the future.
  const sats = flat.filter((d) => d && d.saturday);
  assert.ok(sats.length >= 4 && sats.every((d) => KARTIK.find((k) => k.bs === d.bs_date).weekday === 6));
  assert.ok(sats.filter((d) => d.bs_date > "2083-07-15").every((d) => d.mark === null));
  assert.ok(sats.filter((d) => d.bs_date <= "2083-07-15" && d.bs_date >= "2083-07-03").every((d) => d.mark === "W"));
  // AD labels: "Mon D" on the first day, the day number otherwise.
  assert.match(byDay.get(1).ad_label, /^[A-Z][a-z]{2} \d+$/);
  const chips = calendarChips(weeks);
  assert.deepEqual(chips, {
    present: 3,
    overtime: 1,
    hours: 2,
    absent: 1,
    saturday: sats.filter((d) => d.mark === "W").length,
  });
});

test("calendar months: back to the joining month, never into the future", () => {
  const current = { bs_year: 2083, bs_month: 7 };
  const bounds = calendarBounds("2083-05-12", current);
  assert.deepEqual(bounds, { min: { bs_year: 2083, bs_month: 5 }, max: current });
  assert.deepEqual(stepMonth(current, 1, bounds), current);
  assert.deepEqual(stepMonth(current, -1, bounds), { bs_year: 2083, bs_month: 6 });
  assert.deepEqual(stepMonth({ bs_year: 2083, bs_month: 5 }, -1, bounds), { bs_year: 2083, bs_month: 5 });
  // Joined across a year boundary; a joining date in the future still allows only this month.
  assert.deepEqual(calendarBounds("2082-12-30", current).min, { bs_year: 2082, bs_month: 12 });
  assert.deepEqual(calendarBounds("2083-09-01", current), { min: current, max: current });
  assert.equal(attendanceReportHref(7, current), "/attendance/report?employee=7&bs_year=2083&bs_month=7");
});

const pay = (id, bs, kind = "salary", voided = false) => ({
  id,
  receipt_no: `${kind === "salary" ? "SAL" : "ADV"}-${id}`,
  kind,
  amount: 1000 * id,
  month: { bs_year: 2083, bs_month: Number(bs.slice(5, 7)) },
  payment_mode: { id: 1, name: "Cash" },
  date: { bs, ad: "2026-10-01" },
  voided,
});

test("Last 6 payments: newest first, voided left out, across months", () => {
  const ledger = [
    { month: { bs_year: 2083, bs_month: 7 }, payments: [pay(9, "2083-07-10", "advance"), pay(10, "2083-07-12", "advance", true)] },
    { month: { bs_year: 2083, bs_month: 6 }, payments: [pay(5, "2083-06-02"), pay(6, "2083-06-05", "advance"), pay(7, "2083-07-01")] },
    { month: { bs_year: 2083, bs_month: 5 }, payments: [pay(1, "2083-05-01"), pay(2, "2083-05-09"), pay(3, "2083-06-01"), pay(4, "2083-06-01", "advance", true)] },
  ];
  const last = lastPayments(ledger);
  assert.deepEqual(last.map((e) => e.payment.id), [9, 7, 6, 5, 3, 2]);
  assert.ok(last.every((e) => !e.payment.voided));
  const html = renderToStaticMarkup(createElement(LastPaymentsCard, { ledger, onOpenLedger: () => {} }));
  assert.match(html, /Last 6 payments/);
  assert.match(html, /Open ledger ›/);
  assert.equal((html.match(/data-receipt=/g) ?? []).length, 6);
  assert.doesNotMatch(html, /ADV-10|ADV-4"/);
  assert.match(html, /for Kartik 2083 · Cash/);
  assert.match(html, />Advance</);
});

test("Last 6 payments: a salary payment split over months is one entry", () => {
  const g = (id, m, amount) => ({ ...pay(id, "2083-07-08"), month: { bs_year: 2083, bs_month: m }, amount, payment_group_id: 20 });
  const ledger = [
    { month: { bs_year: 2083, bs_month: 7 }, payments: [pay(30, "2083-07-09", "advance")] },
    { month: { bs_year: 2083, bs_month: 6 }, payments: [g(22, 6, 5000)] },
    { month: { bs_year: 2083, bs_month: 5 }, payments: [g(20, 5, 3000), pay(4, "2083-05-02")] },
  ];
  const last = lastPayments(ledger);
  assert.equal(last.length, 3);
  assert.equal(last[1].payment.amount, 8000);
  assert.deepEqual(last[1].months, [{ bs_year: 2083, bs_month: 5 }, { bs_year: 2083, bs_month: 6 }]);
  assert.deepEqual(last[1].ids.sort(), [20, 22]);
  const html = renderToStaticMarkup(createElement(LastPaymentsCard, { ledger, onOpenLedger: () => {} }));
  assert.match(html, /for Bhadra 2083 – Ashwin 2083 · Cash/);
});
