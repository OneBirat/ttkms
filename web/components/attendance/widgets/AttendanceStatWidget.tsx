import Link from "next/link";
import type { Widget } from "@/lib/api";
import type { AttendanceStatWidgetData } from "../types";
import styles from "./widgets.module.css";

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function readStatData(data: Record<string, unknown>): AttendanceStatWidgetData {
  return {
    present: num(data.present),
    total: num(data.total),
    late: num(data.late),
    leave: num(data.leave),
    href: typeof data.href === "string" ? data.href : "/attendance/report",
  };
}

/** "2 late · 1 on leave" */
export function statHint(d: AttendanceStatWidgetData): string {
  const parts: string[] = [];
  if (d.late) parts.push(`${d.late} late`);
  if (d.leave) parts.push(`${d.leave} on leave`);
  return parts.length ? parts.join(" · ") : "nobody late or on leave";
}

/** Dashboard stat card: "Staff present today 11 / 14 · 2 late · 1 on leave". */
export function AttendanceStatWidget({ widget }: { widget: Widget }) {
  const d = readStatData(widget.data);
  return (
    <Link href={d.href} className={`card ${styles.stat}`} aria-label={`${widget.title}: ${d.present} of ${d.total}, ${statHint(d)}`}>
      <span className={styles.statLabel}>{widget.title}</span>
      <span className={styles.statValue} aria-hidden="true">
        {d.present} <span>/ {d.total}</span>
      </span>
      <span className={styles.statHint} aria-hidden="true">
        {statHint(d)}
      </span>
    </Link>
  );
}
