import Link from "next/link";
import type { Widget } from "@/lib/api";
import type { AttendanceTodayWidgetData, NotInEntry } from "../types";
import styles from "./widgets.module.css";

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function readTodayData(data: Record<string, unknown>): AttendanceTodayWidgetData {
  const notIn = Array.isArray(data.not_in)
    ? data.not_in
        .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
        .map<NotInEntry>((e) => ({
          employee_id: num(e.employee_id),
          name: String(e.name ?? ""),
          status: e.status === "not_marked" ? "not_marked" : "absent",
        }))
    : [];
  return {
    total: num(data.total),
    on_time: num(data.on_time),
    late: num(data.late),
    half_day: num(data.half_day),
    leave: num(data.leave),
    absent: num(data.absent),
    not_marked: num(data.not_marked),
    not_in: notIn,
    mark_path: typeof data.mark_path === "string" ? data.mark_path : "/attendance/mark",
  };
}

type Segment = { kind: keyof Omit<AttendanceTodayWidgetData, "total" | "not_in" | "mark_path">; label: string };

const SEGMENTS: Segment[] = [
  { kind: "on_time", label: "On time" },
  { kind: "late", label: "Late" },
  { kind: "half_day", label: "Half day" },
  { kind: "leave", label: "Leave" },
  { kind: "absent", label: "Absent" },
  { kind: "not_marked", label: "Not marked" },
];

/** "11 present, 2 of them late, 1 on leave, 2 absent out of 14" */
export function barLabel(d: AttendanceTodayWidgetData): string {
  const present = d.on_time + d.late + d.half_day;
  const parts = [`${present} present`];
  if (d.late) parts.push(`${d.late} of them late`);
  if (d.half_day) parts.push(`${d.half_day} half day`);
  if (d.leave) parts.push(`${d.leave} on leave`);
  if (d.absent) parts.push(`${d.absent} absent`);
  if (d.not_marked) parts.push(`${d.not_marked} not marked`);
  return `${parts.join(", ")} out of ${d.total}`;
}

export function AttendanceTodayWidget({ widget }: { widget: Widget }) {
  const d = readTodayData(widget.data);
  const segments = SEGMENTS.filter((s) => d[s.kind] > 0 || (s.kind !== "half_day" && s.kind !== "not_marked"));
  return (
    <section className={`card ${styles.card}`} aria-labelledby="att-today-h">
      <div className={styles.head}>
        <h2 id="att-today-h" className={styles.title}>
          {widget.title}
        </h2>
        <Link href={d.mark_path} className={styles.link}>
          Mark
        </Link>
      </div>
      <div role="img" aria-label={barLabel(d)} className={styles.bar}>
        {segments
          .filter((s) => d[s.kind] > 0)
          .map((s) => (
            <div key={s.kind} className={styles.seg} data-kind={s.kind} style={{ flex: d[s.kind] }} />
          ))}
      </div>
      <ul className={styles.counts}>
        {segments.map((s) => (
          <li key={s.kind} className={styles.count}>
            <span className={`${styles.swatch} ${styles.seg}`} data-kind={s.kind} aria-hidden="true" />
            {s.label} <strong>{d[s.kind]}</strong>
          </li>
        ))}
      </ul>
      {d.not_in.length > 0 ? (
        <div className={styles.notIn}>
          <span className={styles.notInTitle}>Not in yet</span>
          <ul className={styles.notInList}>
            {d.not_in.map((e) => (
              <li key={e.employee_id} className={styles.notInRow}>
                <span>{e.name}</span>
                <span className={styles.notInStatus}>
                  {e.status === "absent" ? "Absent" : "Not marked"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
