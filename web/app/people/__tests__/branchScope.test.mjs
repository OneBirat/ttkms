import { test } from "node:test";
import assert from "node:assert/strict";
import { ALL_BRANCHES, branchParam, resolveBranch } from "../_lib/branchScope.ts";

const branches = [
  { id: 1, name: "Main branch", is_active: true },
  { id: 2, name: "Branch 2", is_active: true },
];

test("without see_other_branches the page is locked to the session branch and shows its name", () => {
  const r = resolveBranch({ canPick: false, sessionBranchId: 2, param: "1", branches });
  assert.deepEqual(r, { branchId: 2, canPick: false, locked: true, label: "Branch 2" });
  // No switcher even when the URL asks for another branch; a user without a branch sees "Your branch".
  assert.equal(resolveBranch({ canPick: false, sessionBranchId: null, param: null, branches }).label, "Your branch");
  assert.equal(resolveBranch({ canPick: false, sessionBranchId: null, param: null, branches }).branchId, null);
});

test("with see_other_branches the default is All branches and ?branch= picks one", () => {
  const all = resolveBranch({ canPick: true, sessionBranchId: 1, param: null, branches });
  assert.deepEqual(all, { branchId: null, canPick: true, locked: false, label: ALL_BRANCHES });
  const one = resolveBranch({ canPick: true, sessionBranchId: 1, param: "2", branches });
  assert.deepEqual(one, { branchId: 2, canPick: true, locked: false, label: "Branch 2" });
  // Unknown or malformed values fall back to All branches.
  assert.equal(resolveBranch({ canPick: true, sessionBranchId: 1, param: "99", branches }).branchId, null);
  assert.equal(resolveBranch({ canPick: true, sessionBranchId: 1, param: "abc", branches }).branchId, null);
});

test("branchParam removes the key for All branches", () => {
  assert.equal(branchParam(null), null);
  assert.equal(branchParam(2), "2");
});
