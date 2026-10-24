/**
 * Per-user access (design/final/AdminUsers.dc.html). A role is only the
 * starting preset: every permission can be switched per user, and a user
 * whose switches differ from the preset is tagged "Custom". Admins always
 * keep "Manage users".
 *
 * Keep in step with app/modules/admin/permissions.py, which enforces this on
 * the API; this file only renders and pre-validates.
 */

import type { Access, PermissionKey, Role } from "./types";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  staff: "Staff",
};

/** One line per role, shown on the role cards. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Everything, all branches",
  manager: "Runs one branch",
  staff: "Mark attendance only",
};

export interface Permission {
  key: PermissionKey;
  label: string;
  description: string;
}

export interface PermissionGroup {
  title: string;
  items: readonly Permission[];
}

export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    title: "Attendance",
    items: [
      { key: "mark_attendance", label: "Mark attendance", description: "Daily marking for their branch" },
      {
        key: "view_attendance_report",
        label: "View attendance report",
        description: "Month / week report and exports",
      },
      {
        key: "see_other_branches",
        label: "See other branches",
        description: "Branch drop-down in reports; off = own branch only",
      },
    ],
  },
  {
    title: "People & payroll",
    items: [
      { key: "manage_employees", label: "View & edit employees", description: "Profiles, photos, salary setup" },
      { key: "salary_advances", label: "Salary & advances", description: "Salary report, payments, advances" },
    ],
  },
  {
    title: "Admin",
    items: [
      { key: "manage_users", label: "Manage users", description: "Add users, roles, reset passwords" },
    ],
  },
];

export const PERMISSIONS: readonly PermissionKey[] = PERMISSION_GROUPS.flatMap((group) =>
  group.items.map((item) => item.key),
);

export const PERMISSION_LABELS: Record<PermissionKey, string> = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((group) => group.items.map((item) => [item.key, item.label])),
) as Record<PermissionKey, string>;

export const ROLE_PRESETS: Record<Role, readonly PermissionKey[]> = {
  admin: PERMISSIONS,
  manager: ["mark_attendance", "view_attendance_report", "manage_employees"],
  staff: ["mark_attendance"],
};

/** Admins can never lose this one. */
export const LOCKED_FOR_ADMIN: PermissionKey = "manage_users";

export function presetFor(role: Role): Access {
  const allowed = new Set(ROLE_PRESETS[role]);
  return Object.fromEntries(PERMISSIONS.map((key) => [key, allowed.has(key)])) as Access;
}

/** Preset of `role` with `overrides` applied; manage_users stays on for admins. */
export function effectiveAccess(
  role: Role,
  overrides: Partial<Record<PermissionKey, boolean>> | null | undefined,
): Access {
  const access = presetFor(role);
  if (overrides) {
    for (const key of PERMISSIONS) {
      if (key in overrides) access[key] = Boolean(overrides[key]);
    }
  }
  if (role === "admin") access[LOCKED_FOR_ADMIN] = true;
  return access;
}

export function accessEquals(a: Access, b: Access): boolean {
  return PERMISSIONS.every((key) => a[key] === b[key]);
}

/** True when `access` differs from the role preset ("Custom"). */
export function isCustom(role: Role, access: Access | null | undefined): boolean {
  if (!access) return false;
  return !accessEquals(effectiveAccess(role, access), presetFor(role));
}

/** Keys where `access` differs from the preset (the "changed" markers / yellow rings). */
export function changedKeys(role: Role, access: Access): PermissionKey[] {
  const preset = presetFor(role);
  return PERMISSIONS.filter((key) => access[key] !== preset[key]);
}

/** What to send: null when equal to the preset, otherwise the full map. */
export function cleanOverrides(role: Role, access: Access | null): Access | null {
  if (!access) return null;
  const effective = effectiveAccess(role, access);
  return accessEquals(effective, presetFor(role)) ? null : effective;
}

export function allowedCount(access: Access): number {
  return PERMISSIONS.filter((key) => access[key]).length;
}

export type PageAccess = "full" | "view" | "none";

export type AdminPage = "users" | "barcodes" | "payment-modes" | "org" | "settings" | "audit";

/**
 * Which admin pages a role may open. Admin: all. Manager: Branches &
 * departments, read-only. Everyone else: nothing. (The API checks the real
 * per-user permissions; this only decides what to render.)
 */
export function adminPageAccess(role: Role | null | undefined, page: AdminPage): PageAccess {
  if (role === "admin") return "full";
  if (role === "manager" && page === "org") return "view";
  return "none";
}
