import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accessFor,
  accessSymbol,
  adminPageAccess,
  AREAS,
  PERMISSION_MATRIX,
  ROLE_DESCRIPTIONS,
} from "../../../web/components/admin/permissions.ts";

const ROLES = ["admin", "manager", "staff"] as const;

test("every role has an entry for every area", () => {
  for (const role of ROLES) {
    for (const area of AREAS) {
      assert.ok(
        ["full", "view", "none"].includes(PERMISSION_MATRIX[role][area.key]),
        `${role}/${area.key}`,
      );
    }
    assert.ok(ROLE_DESCRIPTIONS[role].length > 10);
  }
});

test("admins can do everything; only admins get the Admin area in full", () => {
  for (const area of AREAS) assert.equal(accessFor("admin", area.key), "full");
  assert.equal(accessFor("manager", "admin"), "view");
  assert.equal(accessFor("staff", "admin"), "none");
});

test("store keepers work in stock, staff see only their own records", () => {
  assert.equal(accessFor("staff", "mark_attendance"), "view");
  assert.equal(accessFor("staff", "items"), "none");
  assert.equal(accessFor("unknown" as never, "items"), "none");
});

test("admin page access: admin all, manager org read-only, others nothing", () => {
  for (const page of ["users", "org", "settings", "audit"] as const) {
    assert.equal(adminPageAccess("admin", page), "full");
    assert.equal(adminPageAccess("staff", page), "none");
    assert.equal(adminPageAccess(null, page), "none");
  }
  assert.equal(adminPageAccess("manager", "org"), "view");
  assert.equal(adminPageAccess("manager", "users"), "none");
  assert.equal(adminPageAccess("manager", "audit"), "none");
});

test("matrix symbols", () => {
  assert.equal(accessSymbol("full"), "✓");
  assert.equal(accessSymbol("view"), "view");
  assert.equal(accessSymbol("none"), "—");
});
