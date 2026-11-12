/**
 * Salary report · pay slip printing: which employees are ticked, how many A4 pages that is and
 * the link to the print page. Pure (unit-tested in __tests__/payslips.test.ts); the screen keeps
 * one SelectionState in React state.
 *
 * The selection lives through a department chip, search or sort change and is dropped when the
 * branch or the month changes: it is stored with the scope ("branch:month") it was made in and
 * read back only for that scope.
 */

import { formatBs, kathmanduDateBs } from "@/lib/bs";
import { sortRows } from "./helpers";
import { monthKey } from "./months";
import type { BsMonth, Department, ReportRow, ReportSort } from "../types";

/** Ticked employees: id -> the report row it was ticked on (kept for people a chip now hides). */
export type SlipSelection = ReadonlyMap<number, ReportRow>;

export interface SelectionState {
  scope: string;
  rows: SlipSelection;
}

export const NO_SELECTION: SlipSelection = new Map();

export const PER_PAGE_OPTIONS = [4, 6, 8] as const;
export type PerPage = (typeof PER_PAGE_OPTIONS)[number];
export const DEFAULT_PER_PAGE: PerPage = 4;

/** Slips per A4 page from a query string or storage; anything else is the default (4). */
export function parsePerPage(value: unknown): PerPage {
  const n = Number(value);
  return (PER_PAGE_OPTIONS as readonly number[]).includes(n) ? (n as PerPage) : DEFAULT_PER_PAGE;
}

export function selectionScope(branchId: number | null, month: BsMonth): string {
  return `${branchId ?? "-"}:${monthKey(month)}`;
}

/** The ticks made in `scope`; nothing when the branch or the month has changed since. */
export function selectionIn(state: SelectionState, scope: string): SlipSelection {
  return state.scope === scope ? state.rows : NO_SELECTION;
}

export function toggleRow(selection: SlipSelection, row: ReportRow): SlipSelection {
  const next = new Map(selection);
  if (!next.delete(row.employee.id)) next.set(row.employee.id, row);
  return next;
}

/** Every row currently shown (department chip + search) is ticked; false for an empty list. */
export function allShownSelected(selection: SlipSelection, shown: ReportRow[]): boolean {
  return shown.length > 0 && shown.every((row) => selection.has(row.employee.id));
}

/** Tick every row shown, keeping the ticks on people who are not shown. */
export function selectShown(selection: SlipSelection, shown: ReportRow[]): SlipSelection {
  const next = new Map(selection);
  for (const row of shown) if (!next.has(row.employee.id)) next.set(row.employee.id, row);
  return next;
}

/** Untick the rows shown, keeping the ticks on people who are not shown. */
export function unselectShown(selection: SlipSelection, shown: ReportRow[]): SlipSelection {
  const next = new Map(selection);
  for (const row of shown) next.delete(row.employee.id);
  return next;
}

/** The header checkbox: untick the shown rows when all are ticked, else tick them all. */
export function toggleShown(selection: SlipSelection, shown: ReportRow[]): SlipSelection {
  return allShownSelected(selection, shown) ? unselectShown(selection, shown) : selectShown(selection, shown);
}

/** The ticked rows in the table's sort order, with the freshest copy of each row. */
export function printOrder(selection: SlipSelection, fresh: ReportRow[], sort: ReportSort, departments: Department[]): ReportRow[] {
  const latest = new Map(fresh.map((row) => [row.employee.id, row]));
  const rows = [...selection.values()].map((row) => latest.get(row.employee.id) ?? row);
  return sortRows(rows, sort, departments);
}

/** A4 pages: ceil(slips × (office copy ? 2 : 1) ÷ slips per page). */
export function pageCount(slips: number, perPage: number, officeCopy: boolean): number {
  if (slips <= 0 || perPage <= 0) return 0;
  return Math.ceil((slips * (officeCopy ? 2 : 1)) / perPage);
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const selectedLabel = (n: number) => `${count(n, "pay slip", "pay slips")} selected`;
export const pagesLabel = (pages: number) => count(pages, "A4 page", "A4 pages");
export const printLabel = (n: number) => `Print ${count(n, "pay slip", "pay slips")}`;

export interface PayslipLink {
  branchId: number;
  month: BsMonth;
  /** Employee ids in print order. */
  ids: number[];
  perPage: PerPage;
  officeCopy: boolean;
  /** Open the browser's print dialog as soon as the slips are ready. */
  print?: boolean;
}

export const PAYSLIPS_PATH = "/people/salary/payslips";

export function payslipsHref(link: PayslipLink): string {
  const query = [
    `branch=${link.branchId}`,
    `month=${monthKey(link.month)}`,
    `ids=${link.ids.join(",")}`,
    `per=${link.perPage}`,
    `office=${link.officeCopy ? 1 : 0}`,
  ];
  if (link.print) query.push("print=1");
  return `${PAYSLIPS_PATH}?${query.join("&")}`;
}

const NAMES_SHOWN = 4;

/**
 * "Gita Magar and Hari Bista have attendance days not marked. Mark them before printing, or the
 * slip will be wrong."; null when every ticked employee's days are marked.
 */
export function unmarkedSlipWarning(rows: ReportRow[]): string | null {
  const names = rows.filter((row) => (row.ledger.attendance.not_marked ?? 0) > 0).map((row) => row.employee.full_name);
  if (names.length === 0) return null;
  const shown = names.slice(0, NAMES_SHOWN);
  const more = names.length - shown.length;
  if (more > 0) shown.push(count(more, "other", "others"));
  const list = shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  return `${list} ${names.length === 1 ? "has" : "have"} attendance days not marked. Mark them before printing, or the slip will be wrong.`;
}

/** Tooltip of the "Slip printed" marker: "Printed Kartik 26, 2083 by Asha Admin". */
export function slipPrintedTitle(row: Pick<ReportRow, "slip_printed_at" | "slip_printed_by">): string | null {
  if (!row.slip_printed_at) return null;
  const on = formatBs(kathmanduDateBs(row.slip_printed_at));
  return row.slip_printed_by ? `Printed ${on} by ${row.slip_printed_by}` : `Printed ${on}`;
}

// ---- the last "slips per A4 page" choice, per user (never fails: storage may be blocked)

type PerPageStore = Pick<Storage, "getItem" | "setItem">;

const perPageKey = (userId: number | null) => `ttk.payslips.perPage.${userId ?? "anon"}`;

function browserStore(): PerPageStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadPerPage(userId: number | null, store: PerPageStore | null = browserStore()): PerPage {
  try {
    return parsePerPage(store?.getItem(perPageKey(userId)));
  } catch {
    return DEFAULT_PER_PAGE;
  }
}

export function savePerPage(userId: number | null, perPage: PerPage, store: PerPageStore | null = browserStore()): void {
  try {
    store?.setItem(perPageKey(userId), String(perPage));
  } catch {
    // Private mode / storage full: the choice is simply not remembered.
  }
}
