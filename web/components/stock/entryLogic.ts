/**
 * Pure helpers behind the Stock entry form (desktop and phone layouts share
 * them). No React, no store: everything here is unit-tested in
 * __tests__/entry.test.mjs.
 */

import { adToBs, formatBsLongNp, parseBsIso, weekdayOf, WEEKDAY_NAMES_NP, type BsDate } from "./calendar";
import type { EntryType, StockStatus } from "./types";

/** One row of the form. `qty` is kept as typed (digits only) until save. */
export interface FormRow {
  key: number;
  variationId: number | null;
  qty: string;
  remarks: string;
}

export interface TypeText {
  /** "Purchase" */
  label: string;
  /** "purchase" — inside sentences */
  lower: string;
  /** "खरिद" */
  np: string;
  /** "+ Add purchase" button */
  add: string;
  /** "खरिद थप्नुहोस्" */
  addNp: string;
  save: string;
  saved: string;
  /** "खरिद सेभ भयो" */
  savedNp: string;
  /** "Purchased today so far" */
  todayLabel: string;
  sign: "+" | "−";
}

export const TYPE_TEXT: Record<EntryType, TypeText> = {
  purchase: {
    label: "Purchase",
    lower: "purchase",
    np: "खरिद",
    add: "Add purchase",
    addNp: "खरिद थप्नुहोस्",
    save: "Save purchase",
    saved: "Purchase saved",
    savedNp: "खरिद सेभ भयो",
    todayLabel: "Purchased today so far",
    sign: "+",
  },
  consumption: {
    label: "Consumption",
    lower: "consumption",
    np: "खपत",
    add: "Add consumption",
    addNp: "खपत थप्नुहोस्",
    save: "Save consumption",
    saved: "Consumption saved",
    savedNp: "खपत सेभ भयो",
    todayLabel: "Sold / used today so far",
    sign: "−",
  },
};

export const OTHER_TYPE: Record<EntryType, EntryType> = { purchase: "consumption", consumption: "purchase" };

/** "पहिले खरिद सेभ गर्नुहोस् वा खाली गर्नुहोस्।" */
export function switchBlockedNp(current: EntryType): string {
  return `पहिले ${TYPE_TEXT[current].np} सेभ गर्नुहोस् वा खाली गर्नुहोस्।`;
}

export const LOCK_NP = "सामान बदल्न मिल्दैन। यो लाइन मेटाएर नयाँ सामान थप्नुहोस्।";

/** Keep digits only (the quantity fields accept numbers only). */
export function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

export function rowQty(row: Pick<FormRow, "qty">): number {
  const n = parseInt(row.qty, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** A row with an item and a quantity above 0 keeps its item (desktop lock). */
export function isRowLocked(row: Pick<FormRow, "variationId" | "qty">): boolean {
  return row.variationId !== null && rowQty(row) > 0;
}

export function isRowComplete(row: Pick<FormRow, "variationId" | "qty">): boolean {
  return row.variationId !== null && rowQty(row) > 0;
}

/** Every row has an item and a quantity above 0, and there is at least one row. */
export function rowsValid(rows: Pick<FormRow, "variationId" | "qty">[]): boolean {
  return rows.length > 0 && rows.every(isRowComplete);
}

export function totalQty(rows: Pick<FormRow, "qty">[]): number {
  return rows.reduce((acc, r) => acc + rowQty(r), 0);
}

export const INVALID_SAVE_TEXT = "Pick an item and enter a quantity in every row before saving.";

/** Desktop footer: "No rows to save" | the red hint after an invalid save | "3 rows · 34 pcs". */
export function footerText(rows: Pick<FormRow, "variationId" | "qty">[], saveTried: boolean): string {
  if (rows.length === 0) return "No rows to save";
  if (saveTried && !rowsValid(rows)) return INVALID_SAVE_TEXT;
  return `${rows.length} ${rows.length === 1 ? "row" : "rows"} · ${totalQty(rows)} pcs`;
}

/** Phone save bar caption. */
export function saveCaption(rows: Pick<FormRow, "variationId" | "qty">[]): string {
  if (rows.length === 0) return "Nothing to save yet";
  const warn = rows.some((r) => rowQty(r) <= 0);
  return `${rows.length} ${rows.length === 1 ? "item" : "items"}${warn ? " · check highlighted" : ""}`;
}

/** Number keypad: digits append (max 5, a leading 0 is replaced), "C" clears, "del" removes the last digit. */
export const KEYPAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "del"] as const;
export type KeypadKey = (typeof KEYPAD_KEYS)[number];
export const KEYPAD_MAX_DIGITS = 5;

export function keypadPress(value: string, key: KeypadKey): string {
  if (key === "C") return "";
  if (key === "del") return value.slice(0, -1);
  if (value.length >= KEYPAD_MAX_DIGITS) return value;
  return (value === "0" ? "" : value) + key;
}

/** Stock colour in item lists: red at 0, amber at 5 or fewer. */
export function stockTone(inStock: number): StockStatus {
  return inStock <= 0 ? "out" : inStock <= 5 ? "low" : "ok";
}

const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "Tuesday, 20 October 2026" — the line under the AD date field. */
export function adLongLine(ad: string): string {
  const [y, m, d] = ad.split("-").map(Number);
  if (!y || !m || !d) return "";
  return `${WEEKDAYS_EN[weekdayOf(ad)]}, ${d} ${MONTHS_EN[m - 1]} ${y}`;
}

/** "मंगलबार, कार्तिक ४, २०८३" — the line under the BS date field. */
export function bsNepaliLine(bs: BsDate, ad: string): string {
  return `${WEEKDAY_NAMES_NP[weekdayOf(ad)]}, ${formatBsLongNp(bs)}`;
}

/** BS for an AD date, or null when the AD date is outside the calendar table. */
export function safeAdToBs(ad: string): BsDate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ad)) return null;
  try {
    return adToBs(ad);
  } catch {
    return null;
  }
}

/** Parsed BS date from the typed text, or null while it is incomplete / invalid. */
export function parseBsText(text: string): BsDate | null {
  return parseBsIso(text.trim());
}
