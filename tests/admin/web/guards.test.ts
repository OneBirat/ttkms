import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockedReason,
  canChangeRole,
  canDeactivate,
  countActiveAdmins,
} from "../../../web/components/admin/guards.ts";

const users = [
  { id: 1, role: "admin", is_active: true },
  { id: 2, role: "admin", is_active: true },
  { id: 3, role: "manager", is_active: true },
  { id: 4, role: "admin", is_active: false },
] as const;

test("countActiveAdmins only counts active admins", () => {
  assert.equal(countActiveAdmins(users), 2);
});

test("an admin cannot deactivate or demote themselves", () => {
  assert.equal(canDeactivate(users, users[0], 1), "You cannot deactivate your own account.");
  assert.equal(canChangeRole(users, users[0], "manager", 1), "You cannot remove your own admin role.");
  assert.equal(canChangeRole(users, users[0], "admin", 1), null);
});

test("another admin may be deactivated or demoted while one remains", () => {
  assert.equal(canDeactivate(users, users[1], 1), null);
  assert.equal(canChangeRole(users, users[1], "staff", 1), null);
});

test("the last active admin is protected", () => {
  const single = [users[0], users[2], users[3]];
  assert.equal(
    canDeactivate(single, single[0], 99),
    "There must always be at least one active admin.",
  );
  assert.equal(
    canChangeRole(single, single[0], "manager", 99),
    "There must always be at least one active admin.",
  );
  // Promoting someone else first lifts the block.
  const promoted = [single[0], { id: 3, role: "admin", is_active: true } as const, single[2]];
  assert.equal(canDeactivate(promoted, promoted[0], 99), null);
});

test("non-admins are never blocked by the admin rules", () => {
  assert.equal(canDeactivate(users, users[2], 1), null);
  assert.equal(blockedReason(users, users[2], { role: "staff", is_active: false }, 1), null);
});
