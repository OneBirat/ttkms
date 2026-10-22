/**
 * Pure helpers for the stock module (no React, no "@/" imports, so they can
 * be unit-tested with node:test).
 */

import type {
  DailyHistoryRow,
  MovementType,
  Product,
  StockStatus,
  Variation,
} from "./types";
import { SATURDAY } from "./calendar";

// ------------------------------------------------------------ status

/** OK above the reorder level, Low at or below it, Out at 0. */
export function statusFor(inStock: number, reorderLevel: number): StockStatus {
  if (inStock <= 0) return "out";
  if (inStock <= reorderLevel) return "low";
  return "ok";
}

export const STATUS_LABEL: Record<StockStatus, string> = {
  ok: "OK",
  low: "Low",
  out: "Out",
};

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  opening: "Opening",
  purchase: "Purchase",
  consumption: "Consumption",
};

/** Pill status (web/components/ui/Pill.tsx tone mapping) for a movement type. */
export function movementPillStatus(type: MovementType): string {
  return type === "purchase" ? "ok" : type === "consumption" ? "low" : "leave";
}

// --------------------------------------------------------- duplicates

/** Lower-case, every whitespace removed: "SS  black Cooker" -> "ssblackcooker". */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "");
}

export function sameName(a: string, b: string): boolean {
  return normalizeName(a) === normalizeName(b);
}

/** The existing product whose name matches ignoring case and spaces, if any. */
export function findDuplicateProduct(
  products: Pick<Product, "id" | "name">[],
  name: string,
  ignoreId: number | null = null,
): Pick<Product, "id" | "name"> | null {
  const key = normalizeName(name);
  if (!key) return null;
  return products.find((p) => p.id !== ignoreId && normalizeName(p.name) === key) ?? null;
}

/** True when `name` already exists in `existing` (ignoring case and spaces). */
export function isDuplicateVariation(existing: string[], name: string): boolean {
  const key = normalizeName(name);
  if (!key) return false;
  return existing.some((n) => normalizeName(n) === key);
}

// ------------------------------------------------------------- codes

/** "SS Black cooker" + "3 L" -> "SBC-3L"; "Steel kadhai" + "26 cm" -> "SK-26CM". */
export function variationCode(productName: string, variationName: string): string {
  const initials = productName
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  const suffix = variationName.replace(/[^0-9a-zA-Z.]/g, "").toUpperCase();
  return suffix ? `${initials}-${suffix}` : initials;
}

// ------------------------------------------------------------ search

/** Every word of the query must appear in "product variation" (case-insensitive). */
export function matchesSearch(query: string, productName: string, variationName: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = `${productName} ${variationName}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** Products filtered to the variations matching the query (products with no match are dropped). */
export function filterProducts(products: Product[], query: string): Product[] {
  if (!query.trim()) return products;
  return products
    .map((p) => ({
      ...p,
      variations: p.variations.filter((v) => matchesSearch(query, p.name, v.name)),
    }))
    .filter((p) => p.variations.length > 0);
}

// ---------------------------------------------------------- averages

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** Average over days that are not Saturday (the weekly off); 0 when there are none. */
export function averagePerOpenDay(rows: Pick<DailyHistoryRow, "weekday" | "sold">[]): number {
  const open = rows.filter((r) => r.weekday !== SATURDAY);
  if (open.length === 0) return 0;
  return sum(open.map((r) => r.sold)) / open.length;
}

/** Whole days the stock lasts at `perDay`; null when the pace is 0. */
export function daysLeft(inStock: number, perDay: number): number | null {
  if (perDay <= 0) return null;
  return Math.round(inStock / perDay);
}

/** Round to one decimal as a string ("1.5", "0.0"). */
export function fixed1(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

export function percentChange(from: number, to: number): number | null {
  if (from <= 0) return null;
  return Math.round(((to - from) / from) * 100);
}

// --------------------------------------------------------- BS grouping

/** "2083-07-04" -> "2083-07" */
export function bsMonthKey(dateBs: string): string {
  return dateBs.slice(0, 7);
}

/** True when the row and the next (older) row fall in different BS months: draw a divider. */
export function isMonthBoundary(rows: Pick<DailyHistoryRow, "date_bs">[], index: number): boolean {
  const next = rows[index + 1];
  if (!next) return false;
  return bsMonthKey(rows[index].date_bs) !== bsMonthKey(next.date_bs);
}

/** Groups rows by BS month key keeping first-seen order. */
export function groupByBsMonth<T extends { date_bs: string }>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = bsMonthKey(row.date_bs);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

// ------------------------------------------------------------ totals

export function productTotal(product: Pick<Product, "variations">): number {
  return sum(product.variations.map((v) => v.in_stock));
}

export function lowCount(variations: Pick<Variation, "status">[]): number {
  return variations.filter((v) => v.status !== "ok").length;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "+6" / "−2" / "–" for table cells. */
export function signed(value: number, sign: "+" | "−"): string {
  return value ? `${sign}${value}` : "–";
}

export function toInt(value: string): number {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
