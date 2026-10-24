/**
 * Payment mode kinds (design/final/AdminPaymentModes.dc.html): label, glyph
 * and colours for the icon tile, plus the wording of the details field.
 */

import type { EditableModeType, PaymentModeInput, PaymentModeType } from "./types";

export interface ModeKind {
  label: string;
  /** Glyph in the icon tile. */
  symbol: string;
  bg: string;
  fg: string;
  /** Label of the details field in the form. */
  detailsLabel: string;
  detailsPlaceholder: string;
}

export const MODE_KINDS: Record<PaymentModeType, ModeKind> = {
  cash: {
    label: "Cash",
    symbol: "Rs",
    bg: "#E6F5F3",
    fg: "#0A5454",
    detailsLabel: "Details",
    detailsPlaceholder: "",
  },
  bank: {
    label: "Bank",
    symbol: "🏦",
    bg: "#E3E8F4",
    fg: "#253F73",
    detailsLabel: "Account number",
    detailsPlaceholder: "e.g. A/c ··2231",
  },
  wallet: {
    label: "Wallet",
    symbol: "W",
    bg: "#F3E8F7",
    fg: "#5B2A73",
    detailsLabel: "Wallet ID / phone",
    detailsPlaceholder: "e.g. 98XXXXXXXX",
  },
  qr: {
    label: "QR",
    symbol: "▦",
    bg: "#FFF4CC",
    fg: "#7A5600",
    detailsLabel: "QR / merchant",
    detailsPlaceholder: "e.g. Shop QR · NIC Asia",
  },
  cheque: {
    label: "Cheque",
    symbol: "✎",
    bg: "#ECEEEA",
    fg: "#3E4A52",
    detailsLabel: "Bank / cheque book",
    detailsPlaceholder: "e.g. NIC Asia cheque book",
  },
};

export const EDITABLE_KINDS: readonly EditableModeType[] = ["bank", "wallet", "qr", "cheque"];

/** "Salary · Advance", "Salary", "Advance" or "—". */
export function usedFor(mode: { use_salary: boolean; use_advance: boolean }): string {
  const parts = [mode.use_salary ? "Salary" : "", mode.use_advance ? "Advance" : ""].filter(
    Boolean,
  );
  return parts.join(" · ") || "—";
}

/** Validation message for the form, or null. Mirrors PaymentModeIn on the API. */
export function modeError(input: PaymentModeInput): string | null {
  if (!input.name.replace(/\s+/g, " ").trim()) return "Name is required.";
  if (input.name.trim().length > 80) return "Name must be 80 characters or fewer.";
  if (!input.use_salary && !input.use_advance) {
    return "Pick at least one use: salary payments or advances.";
  }
  return null;
}

/** Trim and collapse spaces; empty details become null. */
export function cleanModeInput(input: PaymentModeInput): PaymentModeInput {
  const details = (input.details ?? "").replace(/\s+/g, " ").trim();
  return {
    ...input,
    name: input.name.replace(/\s+/g, " ").trim(),
    details: details || null,
  };
}
