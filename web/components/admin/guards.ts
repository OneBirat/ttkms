/**
 * Safety rules for user management (also enforced by the backend later):
 * an admin cannot deactivate or demote themselves, and there must always be
 * at least one active admin.
 */

import type { Role } from "./types";

export interface GuardUser {
  id: number;
  role: Role;
  is_active: boolean;
}

export function countActiveAdmins(users: readonly GuardUser[]): number {
  return users.filter((user) => user.role === "admin" && user.is_active).length;
}

/**
 * Would `target` still be an active admin after the change? When not, and
 * it is the last one, the change must be refused.
 */
function removesActiveAdmin(target: GuardUser, next: { role: Role; is_active: boolean }) {
  const wasActiveAdmin = target.role === "admin" && target.is_active;
  const staysActiveAdmin = next.role === "admin" && next.is_active;
  return wasActiveAdmin && !staysActiveAdmin;
}

/**
 * Reason a change to `target`'s role/active flag is not allowed, or null.
 * `actorId` is the signed-in admin making the change.
 */
export function blockedReason(
  users: readonly GuardUser[],
  target: GuardUser,
  next: { role: Role; is_active: boolean },
  actorId: number,
): string | null {
  const self = target.id === actorId;
  if (self && target.is_active && !next.is_active) {
    return "You cannot deactivate your own account.";
  }
  if (self && target.role === "admin" && next.role !== "admin") {
    return "You cannot remove your own admin role.";
  }
  if (removesActiveAdmin(target, next) && countActiveAdmins(users) <= 1) {
    return "There must always be at least one active admin.";
  }
  return null;
}

export function canDeactivate(
  users: readonly GuardUser[],
  target: GuardUser,
  actorId: number,
): string | null {
  return blockedReason(users, target, { role: target.role, is_active: false }, actorId);
}

export function canChangeRole(
  users: readonly GuardUser[],
  target: GuardUser,
  role: Role,
  actorId: number,
): string | null {
  return blockedReason(users, target, { role, is_active: target.is_active }, actorId);
}
