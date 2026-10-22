/**
 * Client-side CSV download used by the "Excel" buttons while the backend
 * export endpoints (to_xlsx) do not exist yet. Excel and LibreOffice open the
 * file directly; the BOM keeps Devanagari text intact in Excel.
 * TODO(backend): replace with links to the /api/stock/...xlsx endpoints.
 */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null)[][]): void {
  const escape = (value: string | number | null) => {
    const text = value === null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [header, ...rows].map((row) => row.map(escape).join(","));
  const blob = new Blob([`﻿${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
