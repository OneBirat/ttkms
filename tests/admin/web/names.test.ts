import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findDuplicateName,
  findDuplicateUsername,
  normalizeName,
  normalizeUsername,
  suggestUsername,
  validateUsername,
} from "../../../web/components/admin/names.ts";

test("normalizeName collapses whitespace, trims and lower-cases", () => {
  assert.equal(normalizeName("  Main   Branch "), "main branch");
  assert.equal(normalizeName("FRONT\tdesk"), "front desk");
  assert.equal(normalizeName(""), "");
});

test("findDuplicateName ignores case and spacing, and the row being renamed", () => {
  const rows = [
    { id: 1, name: "Main branch" },
    { id: 2, name: "Branch 2" },
  ];
  assert.equal(findDuplicateName(rows, "main   BRANCH")?.id, 1);
  assert.equal(findDuplicateName(rows, " branch 2 ")?.id, 2);
  assert.equal(findDuplicateName(rows, "Branch 2", 2), null);
  assert.equal(findDuplicateName(rows, "Branch 3"), null);
  assert.equal(findDuplicateName(rows, "   "), null);
});

test("usernames compare without any spaces or case", () => {
  assert.equal(normalizeUsername(" Sarita .B "), "sarita.b");
  const users = [{ id: 7, username: "sarita.b" }];
  assert.equal(findDuplicateUsername(users, "SARITA.B")?.id, 7);
  assert.equal(findDuplicateUsername(users, "sarita .b")?.id, 7);
  assert.equal(findDuplicateUsername(users, "sarita.b", 7), null);
});

test("validateUsername enforces length and characters", () => {
  assert.equal(validateUsername("sarita.b"), null);
  assert.equal(validateUsername("ab"), "Username must be at least 3 characters.");
  assert.match(validateUsername("sarita b") ?? "", /spaces/);
  assert.match(validateUsername("-sarita") ?? "", /letters, numbers/);
  assert.match(validateUsername("sari@ta") ?? "", /letters, numbers/);
  assert.equal(validateUsername(""), "Username is required.");
});

test("suggestUsername follows the first.initial pattern", () => {
  assert.equal(suggestUsername("Sarita Basnet"), "sarita.b");
  assert.equal(suggestUsername("Ramesh K.C."), "ramesh.k");
  assert.equal(suggestUsername("Tej Bahadur Gharti"), "tej.g");
  assert.equal(suggestUsername("Madonna"), "madonna");
  assert.equal(suggestUsername(""), "");
});
