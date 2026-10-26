import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BranchContext, type ActiveBranchState } from "@/lib/branchContext";
import { DashboardHeader } from "../dashboard/Header";
import { bar, compareCard, moneyTiles, tiles } from "../dashboard/model";
import type { DashboardToday } from "@/lib/api";

const day: DashboardToday = {
  branch: { id: 1, name: "Main branch" },
  date: "2026-10-26",
  date_bs: "2083-07-09",
  attendance: {
    staff: 18,
    present: 9,
    overtime: 2,
    overtime_hours: 5,
    absent: 1,
    not_marked: 6,
    weekly_off: false,
    not_in: [{ employee_id: 4, name: "Nabin Poudel", department: "Store", photo_url: null }],
    mark_path: "/attendance/mark",
  },
  payments: {
    count: 2,
    paid: 12000,
    salary: 10000,
    advances: 2000,
    payments: [
      { payment_id: 7, employee_id: 3, name: "Rajesh Pandey", kind: "salary", amount: 10000, mode: "NIC Asia Bank", time: "10:00", months: 2 },
      { payment_id: 9, employee_id: 5, name: "Gita Magar", kind: "advance", amount: 2000, mode: "Cash", time: "11:00", months: 1 },
    ],
    payments_path: "/people/payments",
  },
};

describe("dashboard figures (one branch)", () => {
  it("tiles: Present = P + O of N staff, overtime staff, absent + not marked, paid", () => {
    assert.deepEqual(
      tiles(day).map((t) => [t.label, t.value, t.sub]),
      [
        ["Present today", "11", "of 18 staff"],
        ["Overtime today", "2", "2 staff on overtime"],
        ["Absent · not marked", "7", "1 absent · 6 not marked"],
        ["Paid today", "Rs 12,000", "2 payments"],
      ],
    );
    // Without salary_advances the API sends no payments: 3 tiles.
    assert.equal(tiles({ ...day, payments: null }).length, 3);
  });

  it("bar colours and shares; a salary group is one payment", () => {
    assert.deepEqual(
      bar(day.attendance!).map((p) => [p.key, p.count, p.colour]),
      [
        ["P", 9, "#1E9E4A"],
        ["O", 2, "#E0A800"],
        ["A", 1, "#C0392B"],
        ["N", 6, "#E6E9E4"],
      ],
    );
    assert.deepEqual(
      moneyTiles(day.payments!).map((t) => [t.label, t.value, t.sub]),
      [
        ["Paid", "Rs 12,000", "2 payments"],
        ["Salary", "Rs 10,000", "1 salary payment"],
        ["Advances", "Rs 2,000", "1 advance"],
      ],
    );
  });

  it("compare card: the branch's own numbers, the not-in names or everyone marked", () => {
    const card = compareCard(day, 0);
    assert.equal(card.marked, "12 of 18 marked");
    assert.deepEqual(card.paid, { amount: "Rs 12,000", count: "2 payments" });
    assert.equal(card.missing, "Nabin Poudel");
    const done = compareCard({ ...day, attendance: { ...day.attendance!, not_marked: 0, not_in: [] } }, 1);
    assert.equal(done.missing, "Everyone is marked ✓");
    assert.equal(compareCard({ ...day, payments: null }, 0).paid, null);
  });
});

function state(over: Partial<ActiveBranchState> = {}): ActiveBranchState {
  return {
    branch: { id: 1, name: "Main branch" },
    branches: [
      { id: 2, name: "Branch 2", staff: 12 },
      { id: 1, name: "Main branch", staff: 18 },
    ],
    canSwitch: true,
    setActiveBranch: async () => {},
    switching: false,
    error: null,
    version: 0,
    ...over,
  };
}

describe("dashboard header", () => {
  const render = (s: ActiveBranchState) =>
    renderToStaticMarkup(createElement(BranchContext.Provider, { value: s }, createElement(DashboardHeader, { today: null })));

  it("see_other_branches: one tab per branch A-Z with its staff, then Compare branches", () => {
    const html = render(state());
    assert.match(html, /aria-selected="false"[^>]*data-testid="compare-tab"[^>]*>Compare branches</);
    assert.match(html, /Dashboard <span[^>]*>· Main branch<\/span>/);
    assert.match(html, /role="tab" aria-selected="false"[^>]*>Branch 2<span[^>]*>12<\/span>/);
    assert.match(html, /role="tab" aria-selected="true"[^>]*>Main branch<span[^>]*>18<\/span>/);
  });

  it("Compare view: the compare tab is selected, no branch tab is, the title says so", () => {
    const html = renderToStaticMarkup(
      createElement(BranchContext.Provider, { value: state() }, createElement(DashboardHeader, { today: null, compare: true })),
    );
    assert.match(html, /· compare branches/);
    assert.match(html, /aria-selected="true"[^>]*data-testid="compare-tab"/);
    assert.doesNotMatch(html, /role="tab" aria-selected="true"[^>]*>Main branch/);
  });

  it("staff: no tabs", () => {
    const html = render(state({ canSwitch: false, branches: [] }));
    assert.doesNotMatch(html, /role="tab"/);
    assert.match(html, /· Main branch/);
  });
});
