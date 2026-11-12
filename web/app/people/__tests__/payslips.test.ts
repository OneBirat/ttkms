import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PER_PAGE,
  NO_SELECTION,
  allShownSelected,
  loadPerPage,
  pageCount,
  pagesLabel,
  parsePerPage,
  payslipsHref,
  printLabel,
  printOrder,
  savePerPage,
  selectShown,
  selectedLabel,
  selectionIn,
  selectionScope,
  slipPrintedTitle,
  toggleRow,
  toggleShown,
  unmarkedSlipWarning,
  unselectShown,
  type SelectionState,
} from "../_lib/payslipSelection";
import type { Department, ReportRow } from "../types";

const STORE: Department = { id: 1, name: "Store" } as Department;
const KITCHEN: Department = { id: 2, name: "Kitchen" } as Department;
const DEPARTMENTS = [KITCHEN, STORE];

function row(id: number, name: string, department: Department, net = 1000, notMarked = 0): ReportRow {
  return {
    employee: { id, code: `E-${String(id).padStart(3, "0")}`, barcode: "", full_name: name, department },
    ledger: { net, due: net, paid_days: 26, attendance: { not_marked: notMarked } },
  } as unknown as ReportRow;
}

const anita = row(1, "Anita", STORE, 9000);
const bikash = row(2, "Bikash", KITCHEN, 12000);
const gita = row(3, "Gita", KITCHEN, 7000);
const ids = (rows: Iterable<ReportRow> | ReadonlyMap<number, ReportRow>) => [...("values" in rows ? (rows as ReadonlyMap<number, ReportRow>).values() : rows)].map((r) => r.employee.id);

describe("pay slip selection", () => {
  it("ticks and unticks one row", () => {
    const one = toggleRow(NO_SELECTION, anita);
    assert.deepEqual(ids(one), [1]);
    assert.deepEqual(ids(toggleRow(one, bikash)), [1, 2]);
    assert.deepEqual(ids(toggleRow(one, anita)), []);
    assert.equal(NO_SELECTION.size, 0);
  });

  it("select all shown ticks only the rows shown and keeps the others", () => {
    // Anita was ticked under "All departments"; the Kitchen chip now shows Bikash and Gita.
    const before = toggleRow(NO_SELECTION, anita);
    const kitchen = [bikash, gita];
    assert.equal(allShownSelected(before, kitchen), false);
    const after = selectShown(before, kitchen);
    assert.deepEqual(ids(after).sort(), [1, 2, 3]);
    assert.equal(allShownSelected(after, kitchen), true);
    // The header box unticks the shown rows only.
    assert.deepEqual(ids(toggleShown(after, kitchen)), [1]);
    assert.deepEqual(ids(unselectShown(after, [anita])).sort(), [2, 3]);
    // Some shown rows ticked -> the header box ticks the rest.
    assert.deepEqual(ids(toggleShown(toggleRow(before, gita), kitchen)).sort(), [1, 2, 3]);
  });

  it("an empty list is never 'all selected'", () => {
    assert.equal(allShownSelected(toggleRow(NO_SELECTION, anita), []), false);
    assert.deepEqual(ids(selectShown(NO_SELECTION, [])), []);
  });

  it("is kept across chip, search and sort; cleared when the branch or the month changes", () => {
    const kartik = { bs_year: 2083, bs_month: 7 };
    const scope = selectionScope(1, kartik);
    const state: SelectionState = { scope, rows: selectShown(NO_SELECTION, [anita, bikash]) };
    // Chip / search / sort do not touch the scope.
    assert.equal(selectionScope(1, { ...kartik }), scope);
    assert.deepEqual(ids(selectionIn(state, scope)), [1, 2]);
    // Another month, another branch.
    assert.equal(selectionIn(state, selectionScope(1, { bs_year: 2083, bs_month: 6 })).size, 0);
    assert.equal(selectionIn(state, selectionScope(2, kartik)).size, 0);
    assert.equal(selectionIn(state, selectionScope(null, kartik)).size, 0);
    // Back on the first scope before anything was ticked elsewhere: still there.
    assert.equal(selectionIn(state, scope).size, 2);
  });

  it("prints in the table's sort order, with the fresh copy of each row", () => {
    const selection = selectShown(NO_SELECTION, [anita, gita, bikash]);
    assert.deepEqual(ids(printOrder(selection, [], "dept", DEPARTMENTS)), [2, 3, 1]);
    assert.deepEqual(ids(printOrder(selection, [], "name", DEPARTMENTS)), [1, 2, 3]);
    assert.deepEqual(ids(printOrder(selection, [], "net", DEPARTMENTS)), [2, 1, 3]);
    // Gita's row was refetched (now the highest net): the fresh row is used.
    const fresh = row(3, "Gita", KITCHEN, 20000);
    const ordered = printOrder(selection, [fresh], "net", DEPARTMENTS);
    assert.deepEqual(ids(ordered), [3, 2, 1]);
    assert.equal(ordered[0], fresh);
  });
});

describe("pay slip pages and labels", () => {
  it("A4 pages = ceil(slips × copies ÷ per page)", () => {
    assert.equal(pageCount(4, 4, false), 1);
    assert.equal(pageCount(5, 4, false), 2);
    assert.equal(pageCount(10, 4, false), 3);
    assert.equal(pageCount(10, 6, false), 2);
    assert.equal(pageCount(10, 8, false), 2);
    assert.equal(pageCount(10, 4, true), 5);
    assert.equal(pageCount(10, 6, true), 4);
    assert.equal(pageCount(1, 8, true), 1);
    assert.equal(pageCount(0, 4, true), 0);
  });

  it("labels", () => {
    assert.equal(selectedLabel(1), "1 pay slip selected");
    assert.equal(selectedLabel(4), "4 pay slips selected");
    assert.equal(pagesLabel(1), "1 A4 page");
    assert.equal(pagesLabel(3), "3 A4 pages");
    assert.equal(printLabel(1), "Print 1 pay slip");
    assert.equal(printLabel(10), "Print 10 pay slips");
  });

  it("slips per page: 4, 6 or 8, else 4", () => {
    assert.equal(DEFAULT_PER_PAGE, 4);
    assert.deepEqual(["4", "6", "8", 6, "5", "", null, undefined, "x"].map(parsePerPage), [4, 6, 8, 6, 4, 4, 4, 4, 4]);
  });

  it("remembers slips per page per user and survives a blocked storage", () => {
    const data = new Map<string, string>();
    const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    assert.equal(loadPerPage(7, store), 4);
    savePerPage(7, 8, store);
    assert.equal(loadPerPage(7, store), 8);
    assert.equal(loadPerPage(9, store), 4);
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    assert.equal(loadPerPage(7, blocked), 4);
    assert.doesNotThrow(() => savePerPage(7, 6, blocked));
    assert.equal(loadPerPage(7, null), 4);
  });

  it("link to the print page", () => {
    const link = { branchId: 3, month: { bs_year: 2083, bs_month: 7 }, ids: [5, 2, 9], perPage: 6 as const, officeCopy: true };
    assert.equal(payslipsHref(link), "/people/salary/payslips?branch=3&month=2083-07&ids=5,2,9&per=6&office=1");
    assert.equal(payslipsHref({ ...link, officeCopy: false, print: true }), "/people/salary/payslips?branch=3&month=2083-07&ids=5,2,9&per=6&office=0&print=1");
  });
});

describe("pay slip warnings and marker", () => {
  it("names the ticked employees with unmarked days", () => {
    assert.equal(unmarkedSlipWarning([anita, bikash]), null);
    const one = unmarkedSlipWarning([anita, row(4, "Hari Bista", STORE, 1, 2)]);
    assert.equal(one, "Hari Bista has attendance days not marked. Mark them before printing, or the slip will be wrong.");
    const two = unmarkedSlipWarning([row(4, "Hari Bista", STORE, 1, 2), row(5, "Gita Magar", STORE, 1, 1)]);
    assert.equal(two, "Hari Bista and Gita Magar have attendance days not marked. Mark them before printing, or the slip will be wrong.");
    const many = unmarkedSlipWarning([1, 2, 3, 4, 5, 6].map((n) => row(n, `P${n}`, STORE, 1, 1)));
    assert.match(many ?? "", /^P1, P2, P3, P4 and 2 others have attendance days not marked\./);
  });

  it("'Slip printed' tooltip: BS date and who", () => {
    assert.equal(slipPrintedTitle({ slip_printed_at: null }), null);
    assert.equal(slipPrintedTitle({}), null);
    // 2026-11-12 10:00 UTC = 15:45 in Kathmandu = Kartik 26, 2083.
    assert.equal(slipPrintedTitle({ slip_printed_at: "2026-11-12T10:00:00Z", slip_printed_by: "Asha Admin" }), "Printed Kartik 26, 2083 by Asha Admin");
    assert.equal(slipPrintedTitle({ slip_printed_at: "2026-11-12T10:00:00Z", slip_printed_by: "" }), "Printed Kartik 26, 2083");
    // 19:00 UTC is already the next day in Kathmandu.
    assert.equal(slipPrintedTitle({ slip_printed_at: "2026-11-12T19:00:00Z" }), "Printed Kartik 27, 2083");
  });
});
