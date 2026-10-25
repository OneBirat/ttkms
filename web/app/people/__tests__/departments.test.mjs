import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanDepartmentName, countText, deleteConfirmText, deleteState, validateDepartmentName } from "../_lib/departments.ts";

const dept = (id, name, employee_count = 0, active_employee_count = employee_count) => ({ id, name, employee_count, active_employee_count });
const existing = [dept(1, "Store", 3, 2), dept(2, "Kitchen", 1), dept(3, "Front desk")];

test("names are trimmed and unique case-insensitively", () => {
  assert.equal(cleanDepartmentName("  Front   desk "), "Front desk");
  assert.equal(validateDepartmentName("Delivery", existing), null);
  assert.equal(validateDepartmentName("   ", existing), "Department name is required.");
  assert.equal(validateDepartmentName("x".repeat(121), existing), "Department name must be 120 characters or fewer.");
  assert.equal(validateDepartmentName(" front  DESK ", existing), 'A department named "Front desk" already exists.');
  // Renaming a department to its own name (or a re-cased version of it) is not a clash.
  assert.equal(validateDepartmentName("STORE", existing, 1), null);
  assert.equal(validateDepartmentName("Store", existing, 2), 'A department named "Store" already exists.');
});

test("delete is enabled only at zero employees; the hint mentions former staff", () => {
  assert.deepEqual(deleteState(dept(3, "Front desk")), { enabled: true, hint: null });
  assert.deepEqual(deleteState(dept(2, "Kitchen", 1)), { enabled: false, hint: "Move 1 employee first" });
  assert.deepEqual(deleteState(dept(1, "Store", 3, 2)), { enabled: false, hint: "Move 3 employees first (includes former staff)" });
  // Only former staff left still blocks the delete (the FK is ON DELETE RESTRICT).
  assert.deepEqual(deleteState(dept(4, "Old", 2, 0)), { enabled: false, hint: "Move 2 employees first (includes former staff)" });
});

test("count and confirm texts", () => {
  assert.equal(countText(dept(3, "Front desk")), "No employees");
  assert.equal(countText(dept(2, "Kitchen", 1)), "1 employee");
  assert.equal(countText(dept(1, "Store", 3, 2)), "3 employees · 1 former");
  assert.equal(deleteConfirmText(dept(1, "Store")), "Delete department Store permanently?");
});
