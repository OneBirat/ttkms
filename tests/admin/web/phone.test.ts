import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatPhone,
  initials,
  isValidPhone,
  normalizePhone,
  phoneDigits,
  phoneError,
} from "../../../web/components/admin/phone.ts";

test("normalizePhone strips spaces, punctuation, +977 and a leading 0", () => {
  assert.equal(normalizePhone("+977 98-4100 0001"), "9841000001");
  assert.equal(normalizePhone("09841000001"), "9841000001");
  assert.equal(normalizePhone("9779841000001"), "9841000001");
  assert.equal(normalizePhone("(985) 700.0001"), "9857000001");
});

test("only ten digits starting 97/98 are valid logins", () => {
  assert.ok(isValidPhone("9841000001") && isValidPhone("+977 9751 234 567"));
  assert.ok(!isValidPhone("1234567890") && !isValidPhone("98410") && !isValidPhone("admin"));
  assert.equal(phoneError(""), "Phone is required.");
  assert.equal(phoneError("9641000001"), "Enter a 10-digit mobile number starting with 97 or 98.");
  assert.equal(phoneError("9841000001"), null);
});

test("input keeps digits only, display groups 4-3-3", () => {
  assert.equal(phoneDigits("98a41 000-00123"), "9841000001");
  assert.equal(formatPhone("9857000001"), "9857 000 001");
  assert.equal(formatPhone(null), "");
  assert.equal(formatPhone("123"), "123");
});

test("initials for the avatar", () => {
  assert.equal(initials("Entro (Owner)"), "EO");
  assert.equal(initials("Sita Thapa"), "ST");
  assert.equal(initials("Ramesh K.C."), "RK");
  assert.equal(initials("Madonna"), "M");
});
