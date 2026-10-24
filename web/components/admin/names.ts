/**
 * Name and username normalisation. Mirrors `normalize_name` /
 * `normalize_username` in app/core/models.py: the database enforces
 * uniqueness on the normalised value, so the UI must compare the same way.
 */

/** Collapse runs of whitespace to one space, trim, lower-case. */
export function normalizeName(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Usernames carry no spaces at all: strip every whitespace and lower-case. */
export function normalizeUsername(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

export interface Named {
  id: number;
  name: string;
}

/**
 * Case- and space-insensitive duplicate check. `ignoreId` excludes the row
 * being renamed. Returns the clashing row or null.
 */
export function findDuplicateName<T extends Named>(
  items: readonly T[],
  candidate: string,
  ignoreId: number | null = null,
): T | null {
  const key = normalizeName(candidate);
  if (!key) return null;
  return (
    items.find((item) => item.id !== ignoreId && normalizeName(item.name) === key) ?? null
  );
}

export interface UsernameOwner {
  id: number;
  username: string;
}

export function findDuplicateUsername<T extends UsernameOwner>(
  items: readonly T[],
  candidate: string,
  ignoreId: number | null = null,
): T | null {
  const key = normalizeUsername(candidate);
  if (!key) return null;
  return (
    items.find(
      (item) => item.id !== ignoreId && normalizeUsername(item.username) === key,
    ) ?? null
  );
}

export const NAME_MAX = 120;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 64;
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

/** Validation message for a branch/department/full name, or null when fine. */
export function validateName(value: string, what = "Name"): string | null {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return `${what} is required.`;
  if (trimmed.length > NAME_MAX) return `${what} must be ${NAME_MAX} characters or fewer.`;
  return null;
}

/** Validation message for a username (already lower-cased by the form), or null. */
export function validateUsername(value: string): string | null {
  const key = normalizeUsername(value);
  if (!key) return "Username is required.";
  if (key.length < USERNAME_MIN) return `Username must be at least ${USERNAME_MIN} characters.`;
  if (key.length > USERNAME_MAX) return `Username must be ${USERNAME_MAX} characters or fewer.`;
  if (/\s/.test(value.trim())) return "Username cannot contain spaces.";
  if (!USERNAME_RE.test(key)) {
    return "Use letters, numbers, dots, dashes or underscores, starting with a letter or number.";
  }
  return null;
}

/** "Sarita Basnet" -> "sarita.b", the pattern suggested by the design. */
export function suggestUsername(fullName: string): string {
  const parts = fullName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z\s.]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].replace(/\./g, "");
  const first = parts[0].replace(/\./g, "");
  const initial = parts[parts.length - 1].charAt(0);
  return `${first}.${initial}`;
}
