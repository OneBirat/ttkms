import { isValidElement, type ReactNode } from "react";
import { formatNumber } from "@/lib/format";
import { Pill } from "./Pill";
import styles from "./DataTable.module.css";

export interface Column {
  key: string;
  label: string;
  /** Numeric column: right-aligned, mono font, numbers grouped. */
  num?: boolean;
  /** Render the value as a status <Pill>. */
  pill?: boolean;
  align?: "left" | "center" | "right";
  /** Any CSS width, e.g. "120px" or "20%". */
  width?: string;
}

export interface DataTableProps {
  columns: Column[];
  rows: Record<string, unknown>[];
  compact?: boolean;
  emptyText?: string;
  /** Stable row key; defaults to the row's `id` or its index. */
  rowKey?: (row: Record<string, unknown>, index: number) => string | number;
  caption?: string;
}

function renderCell(value: unknown, column: Column): ReactNode {
  if (value === null || value === undefined || value === "") {
    return <span className="muted">—</span>;
  }
  if (typeof value === "object" && isValidElement(value)) {
    return value;
  }
  if (column.pill) {
    return <Pill status={String(value)} />;
  }
  if (typeof value === "number") {
    return formatNumber(value);
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return String(value);
}

function cellClass(column: Column): string {
  const align = column.align ?? (column.num ? "right" : "left");
  const classes = [styles.cell, styles[`align-${align}`]];
  if (column.num) classes.push(styles.num);
  return classes.join(" ");
}

function defaultRowKey(row: Record<string, unknown>, index: number) {
  const id = row.id;
  return typeof id === "string" || typeof id === "number" ? id : index;
}

export function DataTable({
  columns,
  rows,
  compact = false,
  emptyText = "Nothing to show yet.",
  rowKey = defaultRowKey,
  caption,
}: DataTableProps) {
  return (
    <div className={`card ${styles.wrap}`}>
      <table className={styles.table} data-compact={compact ? "true" : undefined}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cellClass(column)}
                style={column.width ? { width: column.width } : undefined}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className={styles.empty} colSpan={columns.length}>
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={rowKey(row, index)}>
                {columns.map((column) => (
                  <td key={column.key} className={cellClass(column)}>
                    {renderCell(row[column.key], column)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
