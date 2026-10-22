import { apiFetch, type BsConvertResponse } from "@/lib/api";

/** Bikram Sambat month names, index 0 = Baishakh. */
export const BS_MONTHS_EN = [
  "Baishakh",
  "Jestha",
  "Ashadh",
  "Shrawan",
  "Bhadra",
  "Ashwin",
  "Kartik",
  "Mangsir",
  "Poush",
  "Magh",
  "Falgun",
  "Chaitra",
] as const;

export const BS_MONTHS_NP = [
  "बैशाख",
  "जेठ",
  "असार",
  "साउन",
  "भदौ",
  "असोज",
  "कार्तिक",
  "मंसिर",
  "पुस",
  "माघ",
  "फागुन",
  "चैत",
] as const;

const DEVANAGARI_DIGITS = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"];

/** "2083-07-04" -> "२०८३-०७-०४"; non-digit characters are kept as they are. */
export function toDevanagariDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (d) => DEVANAGARI_DIGITS[Number(d)]);
}

export interface BsParts {
  year: number;
  month: number;
  day: number;
}

/** Parses "YYYY-MM-DD" (BS); null when the shape or ranges are wrong. */
export function parseBs(value: string): BsParts | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 32) return null;
  return { year, month, day };
}

/** formatBs("2083-07-04") -> "Kartik 4, 2083"; invalid input is returned unchanged. */
export function formatBs(value: string): string {
  const parts = parseBs(value);
  if (!parts) return value;
  return `${BS_MONTHS_EN[parts.month - 1]} ${parts.day}, ${parts.year}`;
}

/** formatBsNp("2083-07-04") -> "कार्तिक ४, २०८३"; invalid input is returned unchanged. */
export function formatBsNp(value: string): string {
  const parts = parseBs(value);
  if (!parts) return value;
  return `${BS_MONTHS_NP[parts.month - 1]} ${toDevanagariDigits(parts.day)}, ${toDevanagariDigits(parts.year)}`;
}

/**
 * Converts an AD date ("YYYY-MM-DD") through GET /api/bsdate/convert.
 * Throws ApiError 422 for invalid input and 503 while the BS table is missing.
 */
export function convertAdToBs(
  ad: string,
  signal?: AbortSignal,
): Promise<BsConvertResponse> {
  return apiFetch<BsConvertResponse>(
    `/api/bsdate/convert?ad=${encodeURIComponent(ad)}`,
    { signal },
  );
}

/** Converts a BS date ("YYYY-MM-DD") through GET /api/bsdate/convert. */
export function convertBsToAd(
  bs: string,
  signal?: AbortSignal,
): Promise<BsConvertResponse> {
  return apiFetch<BsConvertResponse>(
    `/api/bsdate/convert?bs=${encodeURIComponent(bs)}`,
    { signal },
  );
}
