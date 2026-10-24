/** Barcode stickers: /api/admin/barcodes (app/modules/admin). */

import { apiFetch } from "@/lib/api";
import type { BarcodesResponse } from "./types";

export function loadBarcodes(): Promise<BarcodesResponse> {
  return apiFetch<BarcodesResponse>("/api/admin/barcodes");
}

/** Download URL of the A4 sticker PDF for the selected employees. */
export function barcodePdfUrl(ids: number[], size: string): string {
  return `/api/admin/barcodes.pdf?ids=${ids.join(",")}&size=${encodeURIComponent(size)}`;
}
