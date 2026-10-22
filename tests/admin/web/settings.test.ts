import { test } from "node:test";
import assert from "node:assert/strict";
import {
  changedGroups,
  groupHasErrors,
  isValidTime,
  SETTINGS_DEFAULTS,
  settingsEqual,
  validateSettings,
} from "../../../web/components/admin/settingsValidation.ts";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test("defaults are valid and match the brief", () => {
  assert.deepEqual(validateSettings(SETTINGS_DEFAULTS), {});
  assert.equal(SETTINGS_DEFAULTS.attendance.late_after, "09:30");
  assert.deepEqual(SETTINGS_DEFAULTS.attendance.weekly_off, ["sat"]);
  assert.equal(SETTINGS_DEFAULTS.stock.default_reorder_level, 5);
  assert.equal(SETTINGS_DEFAULTS.stock.default_unit, "pcs");
  assert.equal(SETTINGS_DEFAULTS.payroll.rounding, "nearest_rupee");
});

test("company validation", () => {
  const input = clone(SETTINGS_DEFAULTS);
  input.company.name = "   ";
  input.company.phone = "call me";
  input.company.pan_vat = "12345";
  const errors = validateSettings(input);
  assert.equal(errors["company.name"], "Company name is required.");
  assert.match(errors["company.phone"], /digits/);
  assert.match(errors["company.pan_vat"], /9 digits/);
  assert.ok(groupHasErrors(errors, "company"));
  assert.ok(!groupHasErrors(errors, "payroll"));
  input.company.name = "TTK";
  input.company.phone = "01-4231123";
  input.company.pan_vat = "123456789";
  assert.deepEqual(validateSettings(input), {});
});

test("attendance validation: time format and at least one working day", () => {
  assert.ok(isValidTime("09:30"));
  assert.ok(isValidTime("23:59"));
  assert.ok(!isValidTime("9:30"));
  assert.ok(!isValidTime("24:00"));
  const input = clone(SETTINGS_DEFAULTS);
  input.attendance.late_after = "930";
  input.attendance.weekly_off = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const errors = validateSettings(input);
  assert.match(errors["attendance.late_after"], /24-hour/);
  assert.match(errors["attendance.weekly_off"], /working day/);
});

test("payroll and stock ranges", () => {
  const input = clone(SETTINGS_DEFAULTS);
  input.payroll.pay_day = 0;
  input.stock.default_reorder_level = -1;
  input.stock.default_unit = "";
  let errors = validateSettings(input);
  assert.match(errors["payroll.pay_day"], /1 to 32/);
  assert.match(errors["stock.default_reorder_level"], /whole number/);
  assert.match(errors["stock.default_unit"], /required/);
  input.payroll.pay_day = 33;
  input.stock.default_reorder_level = 2.5;
  errors = validateSettings(input);
  assert.ok(errors["payroll.pay_day"]);
  assert.ok(errors["stock.default_reorder_level"]);
  input.payroll.pay_day = 32;
  input.stock.default_reorder_level = 0;
  input.stock.default_unit = "pcs";
  assert.deepEqual(validateSettings(input), {});
});

test("dirty tracking by group", () => {
  const a = clone(SETTINGS_DEFAULTS);
  const b = clone(SETTINGS_DEFAULTS);
  assert.ok(settingsEqual(a, b));
  assert.deepEqual(changedGroups(a, b), []);
  b.payroll.pay_day = 7;
  b.display.nepali_digits = true;
  assert.ok(!settingsEqual(a, b));
  assert.deepEqual(changedGroups(a, b), ["payroll", "display"]);
});
