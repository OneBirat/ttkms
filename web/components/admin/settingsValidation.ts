/**
 * Settings defaults and inline validation. Pure functions so they can be
 * unit-tested with node:test and reused by the backend contract later.
 */

import type { SettingsGroup, SettingsInput, Weekday } from "./types";

export const SETTINGS_DEFAULTS: SettingsInput = {
  company: { name: "TTK", address: "", phone: "", pan_vat: "" },
  attendance: {
    late_after: "09:30",
    weekly_off: ["sat"],
    half_day_note:
      "Arriving after 12:00 or leaving before 14:00 counts as a half day (½ day pay).",
  },
  payroll: { pay_day: 1, default_paid_by: "cash", rounding: "nearest_rupee" },
  stock: { default_reorder_level: 5, default_unit: "pcs" },
  display: { show_ad_dates: true, nepali_digits: false },
};

export const WEEKDAY_VALUES: readonly Weekday[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

/** Field path -> message, e.g. "attendance.late_after". */
export type SettingsErrors = Record<string, string>;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const PHONE_RE = /^[0-9+][0-9\s\-]{5,19}$/;
const PAN_RE = /^\d{9}$/;

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value);
}

export function validateSettings(input: SettingsInput): SettingsErrors {
  const errors: SettingsErrors = {};

  const name = input.company.name.trim();
  if (!name) errors["company.name"] = "Company name is required.";
  else if (name.length > 120) errors["company.name"] = "Keep it under 120 characters.";
  if (input.company.address.length > 240) {
    errors["company.address"] = "Keep it under 240 characters.";
  }
  const phone = input.company.phone.trim();
  if (phone && !PHONE_RE.test(phone)) {
    errors["company.phone"] = "Enter digits only, e.g. 01-4XXXXXX or 98XXXXXXXX.";
  }
  const pan = input.company.pan_vat.trim();
  if (pan && !PAN_RE.test(pan)) {
    errors["company.pan_vat"] = "PAN/VAT numbers have 9 digits.";
  }

  if (!isValidTime(input.attendance.late_after)) {
    errors["attendance.late_after"] = "Use 24-hour time, e.g. 09:30.";
  }
  const offDays = input.attendance.weekly_off;
  if (offDays.some((day) => !WEEKDAY_VALUES.includes(day))) {
    errors["attendance.weekly_off"] = "Unknown weekday.";
  } else if (offDays.length >= 7) {
    errors["attendance.weekly_off"] = "At least one working day is needed.";
  }
  if (input.attendance.half_day_note.length > 240) {
    errors["attendance.half_day_note"] = "Keep the note under 240 characters.";
  }

  const payDay = input.payroll.pay_day;
  if (!Number.isInteger(payDay) || payDay < 1 || payDay > 32) {
    errors["payroll.pay_day"] = "Pay day is a BS day of month, 1 to 32.";
  }
  if (!["cash", "bank"].includes(input.payroll.default_paid_by)) {
    errors["payroll.default_paid_by"] = "Choose Cash or Bank.";
  }
  if (!["nearest_rupee", "none"].includes(input.payroll.rounding)) {
    errors["payroll.rounding"] = "Choose a rounding rule.";
  }

  const reorder = input.stock.default_reorder_level;
  if (!Number.isInteger(reorder) || reorder < 0 || reorder > 100000) {
    errors["stock.default_reorder_level"] = "Enter a whole number, 0 or more.";
  }
  const unit = input.stock.default_unit.trim();
  if (!unit) errors["stock.default_unit"] = "Unit is required, e.g. pcs.";
  else if (unit.length > 16) errors["stock.default_unit"] = "Keep the unit short (16 characters).";

  return errors;
}

export function groupHasErrors(errors: SettingsErrors, group: SettingsGroup): boolean {
  return Object.keys(errors).some((key) => key.startsWith(`${group}.`));
}

/** Deep-ish equality for the settings form (plain data only). */
export function settingsEqual(a: SettingsInput, b: SettingsInput): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Groups whose values differ between two inputs. */
export function changedGroups(a: SettingsInput, b: SettingsInput): SettingsGroup[] {
  const groups: SettingsGroup[] = ["company", "attendance", "payroll", "stock", "display"];
  return groups.filter((group) => JSON.stringify(a[group]) !== JSON.stringify(b[group]));
}
