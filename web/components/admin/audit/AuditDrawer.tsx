"use client";

import { Pill } from "@/components/ui/Pill";
import type { AuditEntry, AuditValues } from "../types";
import { adDateTime, bsDateTime, bsLong } from "../dates";
import { Drawer } from "../components/Drawer";
import { MODULE_TONE, actionLabel } from "./labels";
import styles from "../components/admin.module.css";

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.map(formatValue).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export interface DiffRow {
  key: string;
  before: unknown;
  after: unknown;
  changed: boolean;
}

/** Union of keys from before/after, flagged when the two sides differ. */
export function diffRows(before: AuditValues | null, after: AuditValues | null): DiffRow[] {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  return keys.map((key) => {
    const b = before?.[key];
    const a = after?.[key];
    return { key, before: b, after: a, changed: JSON.stringify(b) !== JSON.stringify(a) };
  });
}

export function AuditDrawer({
  entry,
  onClose,
}: {
  entry: AuditEntry | null;
  onClose: () => void;
}) {
  const rows = entry ? diffRows(entry.before, entry.after) : [];
  return (
    <Drawer
      open={entry !== null}
      title={entry ? actionLabel(entry) : ""}
      subtitle={entry ? `${entry.entity}${entry.entity_id ? ` · ${entry.entity_id}` : ""}` : ""}
      onClose={onClose}
    >
      {entry ? (
        <>
          <dl className={styles.diffMeta}>
            <dt>When</dt>
            <dd>
              {bsLong(entry.at_bs)} · {bsDateTime(entry.at_bs, entry.at)}
              <span className={styles.secondary}>{adDateTime(entry.at)} AD</span>
            </dd>
            <dt>User</dt>
            <dd>
              {entry.user ? (
                <>
                  {entry.user.full_name} <span className="muted mono">{entry.user.username}</span>
                </>
              ) : (
                <span className="muted">System</span>
              )}
            </dd>
            <dt>Module</dt>
            <dd>
              <Pill status={MODULE_TONE[entry.module]} label={entry.module} className={styles.modulePill} />
            </dd>
            <dt>Action</dt>
            <dd className="mono">{entry.action}</dd>
            <dt>Entity</dt>
            <dd>
              {entry.entity}
              {entry.entity_id ? <span className="mono"> #{entry.entity_id}</span> : null}
            </dd>
          </dl>

          {rows.length === 0 ? (
            <p className="muted">No field values were recorded for this change.</p>
          ) : (
            <table className={styles.diff}>
              <caption className="sr-only">Changed fields</caption>
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Before</th>
                  <th scope="col">After</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className={row.changed ? styles.diffChanged : undefined}>
                    <td>{row.key.replace(/_/g, " ")}</td>
                    <td>
                      <span className={styles.diffValue}>{formatValue(row.before)}</span>
                    </td>
                    <td>
                      <span className={styles.diffValue}>{formatValue(row.after)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}
    </Drawer>
  );
}
