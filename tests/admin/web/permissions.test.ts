import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accessEquals,
  adminPageAccess,
  allowedCount,
  changedKeys,
  cleanOverrides,
  effectiveAccess,
  isCustom,
  PERMISSION_GROUPS,
  PERMISSIONS,
  presetFor,
  ROLE_DESCRIPTIONS,
  ROLE_PRESETS,
} from "../../../web/components/admin/permissions.ts";

const ROLES = ["admin", "manager", "staff"] as const;

test("the catalogue matches the design and the backend", () => {
  assert.deepEqual(PERMISSIONS, [
    "mark_attendance",
    "view_attendance_report",
    "see_other_branches",
    "manage_employees",
    "salary_advances",
    "manage_users",
  ]);
  assert.deepEqual(
    PERMISSION_GROUPS.map((g) => g.title),
    ["Attendance", "People & payroll", "Admin"],
  );
  for (const role of ROLES) assert.ok(ROLE_DESCRIPTIONS[role].length > 5);
});

test("role presets: admin all, manager three, staff mark attendance only", () => {
  assert.equal(allowedCount(presetFor("admin")), PERMISSIONS.length);
  assert.deepEqual([...ROLE_PRESETS.manager], [
    "mark_attendance",
    "view_attendance_report",
    "manage_employees",
  ]);
  assert.deepEqual(
    Object.entries(presetFor("staff"))
      .filter(([, on]) => on)
      .map(([key]) => key),
    ["mark_attendance"],
  );
});

test("effectiveAccess applies overrides and locks manage_users for admins", () => {
  const access = effectiveAccess("staff", { salary_advances: true });
  assert.equal(access.salary_advances, true);
  assert.equal(access.mark_attendance, true);
  assert.equal(effectiveAccess("admin", { manage_users: false }).manage_users, true);
  assert.equal(effectiveAccess("manager", { manage_users: true }).manage_users, true);
});

test("custom detection, changed keys and what gets sent", () => {
  assert.equal(isCustom("manager", null), false);
  assert.equal(isCustom("manager", presetFor("manager")), false);
  const custom = effectiveAccess("manager", { salary_advances: true, mark_attendance: false });
  assert.equal(isCustom("manager", custom), true);
  assert.deepEqual(changedKeys("manager", custom), ["mark_attendance", "salary_advances"]);
  assert.equal(cleanOverrides("staff", presetFor("staff")), null);
  const sent = cleanOverrides("staff", effectiveAccess("staff", { mark_attendance: false }));
  assert.ok(sent && accessEquals(sent, effectiveAccess("staff", { mark_attendance: false })));
  assert.equal(cleanOverrides("admin", effectiveAccess("admin", { manage_users: false })), null);
});

test("adminPageAccess: admins everything, managers org read-only, others nothing", () => {
  for (const page of ["users", "barcodes", "payment-modes", "org", "settings", "audit"] as const) {
    assert.equal(adminPageAccess("admin", page), "full");
    assert.equal(adminPageAccess("staff", page), "none");
    assert.equal(adminPageAccess("manager", page), page === "org" ? "view" : "none");
  }
  assert.equal(adminPageAccess(null, "users"), "none");
});
