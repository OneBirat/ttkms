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
          status: e.status === "N" ? "N" : "A",
        }))
    : [];
  return {
    total: num(data.total),
    present: num(data.present),
    overtime: num(data.overtime),
    absent: num(data.absent),
    not_marked: num(data.not_marked),
    overtime_hours: num(data.overtime_hours),
    not_in: notIn,
    mark_path: typeof data.mark_path === "string" ? data.mark_path : "/attendance/mark",
  };
}

type SegmentKind = "present" | "overtime" | "absent" | "not_marked";

const SEGMENTS: { kind: SegmentKind; label: string }[] = [
  { kind: "present", label: "Present" },
  { kind: "overtime", label: "Overtime" },
  { kind: "absent", label: "Absent" },
  { kind: "not_marked", label: "Not marked" },
];

/** "11 present, 3 of them with overtime (5 h), 2 absent, 1 not marked out of 14" */
export function barLabel(d: AttendanceTodayWidgetData): string {
  const parts = [`${d.present + d.overtime} present`];
  if (d.overtime) parts.push(`${d.overtime} of them with overtime (${d.overtime_hours} h)`);
  if (d.absent) parts.push(`${d.absent} absent`);
  if (d.not_marked) parts.push(`${d.not_marked} not marked`);
  return `${parts.join(", ")} out of ${d.total}`;
}

/** "Attendance today" card (design/attendance/Main.dc.html): bar, counts, "Not in yet". */
export function AttendanceTodayWidget({ widget }: { widget: Widget }) {
  const d = readTodayData(widget.data);
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
        {SEGMENTS.filter((s) => d[s.kind] > 0).map((s) => (
          <div key={s.kind} className={styles.seg} data-kind={s.kind} style={{ flex: d[s.kind] }} />
        ))}
      </div>
      <ul className={styles.counts}>
        {SEGMENTS.map((s) => (
          <li key={s.kind} className={styles.count}>
            <span className={`${styles.swatch} ${styles.seg}`} data-kind={s.kind} aria-hidden="true" />
            {s.label}
            {s.kind === "overtime" && d.overtime_hours ? (
              <span className={styles.countHint}>· {d.overtime_hours} h</span>
            ) : null}
            <strong>{d[s.kind]}</strong>
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
                <span className={styles.notInStatus}>{e.status === "A" ? "Absent" : "Not marked"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
