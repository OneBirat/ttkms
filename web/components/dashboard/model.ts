/**
 * The dashboard's figures for ONE branch (design/dashboard-branch), from GET /api/dashboard/today:
 * pure functions so the node tests cover them. Nothing here ever adds branches together.
 */

import type { DashboardAttendance, DashboardPayments, DashboardToday } from "@/lib/api";

const rs = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
export const formatRs = (n: number) => rs.format(n);

export const MARK_COLOURS = { P: "#1E9E4A", O: "#E0A800", A: "#C0392B", N: "#E6E9E4" } as const;

export interface Tile {
  key: "present" | "overtime" | "absent" | "paid";
  label: string;
  value: string;
  sub: string;
  /** Colour of the big number. */
  colour: string;
  href: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Present today / Overtime today / Absent · not marked (attendance) and Paid today (payments). */
export function tiles(day: Pick<DashboardToday, "attendance" | "payments">): Tile[] {
  const out: Tile[] = [];
  const a = day.attendance;
  if (a) {
    out.push({
      key: "present",
      label: "Present today",
      value: String(a.present + a.overtime),
      sub: `of ${plural(a.staff, "staff", "staff")}`,
      colour: "#0A5454",
      href: a.mark_path,
    });
    out.push({
      key: "overtime",
      label: "Overtime today",
      value: String(a.overtime),
      sub: a.overtime ? `${plural(a.overtime, "staff", "staff")} on overtime` : "no overtime yet",
      colour: "#7A5600",
      href: a.mark_path,
    });
    out.push({
      key: "absent",
      label: "Absent · not marked",
      value: String(a.absent + a.not_marked),
      sub: `${a.absent} absent · ${a.not_marked} not marked`,
      colour: "#8E2F12",
      href: a.mark_path,
    });
  }
  const p = day.payments;
  if (p) {
    out.push({
      key: "paid",
      label: "Paid today",
      value: `Rs ${formatRs(p.paid)}`,
      sub: plural(p.count, "payment"),
      colour: "#1B2328",
      href: p.payments_path,
    });
  }
  return out;
}

export interface BarPart {
  key: "P" | "O" | "A" | "N";
  label: string;
  count: number;
  /** Share of the bar, 0-100. */
  percent: number;
  colour: string;
}

/** Stacked bar + legend: Present, Overtime, Absent, Not marked (shares of the branch's staff). */
export function bar(a: DashboardAttendance): BarPart[] {
  const parts: [BarPart["key"], string, number][] = [
    ["P", "Present", a.present],
    ["O", "Overtime", a.overtime],
    ["A", "Absent", a.absent],
    ["N", "Not marked", a.not_marked],
  ];
  const total = Math.max(1, a.staff);
  return parts.map(([key, label, count]) => ({ key, label, count, percent: (count / total) * 100, colour: MARK_COLOURS[key] }));
}

export interface MoneyTile {
  label: string;
  value: string;
  sub: string;
  tone: "paid" | "salary" | "advance";
}

/** Paid (grey) / Salary (teal) / Advances (blue); a salary payment group is one payment. */
export function moneyTiles(p: DashboardPayments): MoneyTile[] {
  const salaries = p.payments.filter((x) => x.kind === "salary").length;
  const advances = p.payments.filter((x) => x.kind === "advance").length;
  return [
    { label: "Paid", value: `Rs ${formatRs(p.paid)}`, sub: plural(p.count, "payment"), tone: "paid" },
    { label: "Salary", value: `Rs ${formatRs(p.salary)}`, sub: plural(salaries, "salary payment"), tone: "salary" },
    { label: "Advances", value: `Rs ${formatRs(p.advances)}`, sub: plural(advances, "advance"), tone: "advance" },
  ];
}

/** One branch's card on "Compare branches" - its own numbers only, never a total. */
export interface CompareCard {
  branchId: number;
  name: string;
  staff: number;
  accent: string;
  tiles: { label: string; value: number; tone: "P" | "O" | "A" | "N" }[];
  bar: BarPart[] | null;
  marked: string | null;
  paid: string | null;
  missing: string | null;
}

const ACCENTS = ["#0E6B6B", "#2F4E8C", "#7A5600", "#7A3E6B", "#3E6B2F"];

export function compareCard(day: DashboardToday, index: number): CompareCard {
  const a = day.attendance;
  return {
    branchId: day.branch.id,
    name: day.branch.name,
    staff: a?.staff ?? 0,
    accent: ACCENTS[index % ACCENTS.length],
    tiles: a
      ? [
          { label: "Present", value: a.present + a.overtime, tone: "P" },
          { label: "Overtime", value: a.overtime, tone: "O" },
          { label: "Absent", value: a.absent, tone: "A" },
          { label: "Not marked", value: a.not_marked, tone: "N" },
        ]
      : [],
    bar: a ? bar(a) : null,
    marked: a ? `${a.staff - a.not_marked} of ${a.staff} marked` : null,
    paid: day.payments ? `Rs ${formatRs(day.payments.paid)} · ${plural(day.payments.count, "payment")}` : null,
    missing: a ? (a.weekly_off ? "Saturday · weekly off" : a.not_in.map((p) => p.name).join(", ") || "Everyone is marked ✓") : null,
  };
}

/** "AG" from "Anita Gurung". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
