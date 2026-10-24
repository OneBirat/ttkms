"use client";

import type { ExportFile } from "./types";

/** Saves a file through a temporary object URL. */
export function downloadFile(file: ExportFile): void {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Opens the print window synchronously (inside the click, so pop-up blockers
 * allow it); fill it later with `writePrintDocument`. Null when blocked.
 */
export function openPrintWindow(): Window | null {
  const w = window.open("", "_blank");
  if (w) {
    w.document.title = "Preparing report…";
  }
  return w;
}

/** Writes the print-ready HTML and prints once its fonts are loaded. */
export async function writePrintDocument(target: Window, file: ExportFile): Promise<void> {
  const html = await file.blob.text();
  target.document.open();
  target.document.write(html);
  target.document.close();
  const ready = target.document.fonts?.ready ?? Promise.resolve();
  await ready.catch(() => undefined);
  target.focus();
  target.print();
}
