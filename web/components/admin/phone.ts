/**
 * Login phone numbers. Twin of `normalize_phone` / `PHONE_RE` in
 * app/core/models.py: ten digits starting with 97 or 98, stored without
 * spaces or country code.
 */

export const PHONE_RE = /^9[78]\d{8}$/;
export const PHONE_ERROR = "Enter a 10-digit mobile number starting with 97 or 98.";

/** "+977 98-4100 0001" -> "9841000001" (country code and punctuation dropped). */
export function normalizePhone(value: string): string {
  let digits = value.trim().replace(/[\s\-().]+/g, "");
  if (digits.startsWith("+977")) digits = digits.slice(4);
  else if (digits.startsWith("977") && digits.length === 13) digits = digits.slice(3);
  if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  return digits;
}

export function isValidPhone(value: string): boolean {
  return PHONE_RE.test(normalizePhone(value));
}

/** Validation message for the phone field, or null when fine. */
export function phoneError(value: string): string | null {
  const digits = normalizePhone(value);
  if (!digits) return "Phone is required.";
  return PHONE_RE.test(digits) ? null : PHONE_ERROR;
}

/** Keep what a user types to digits, at most ten. */
export function phoneDigits(input: string): string {
  return input.replace(/\D/g, "").slice(0, 10);
}

/** "9857000001" -> "9857 000 001" for display. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = normalizePhone(phone);
  if (digits.length !== 10) return phone;
  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
}

/** Initials for the avatar circle: "Entro (Owner)" -> "EO", "Sita Thapa" -> "ST". */
export function initials(fullName: string): string {
  const words = fullName
    .replace(/[()]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words
    .map((word) => word.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
