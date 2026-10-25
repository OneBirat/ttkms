import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { branchOptions, branchParam, resolveBranch } from "../_lib/branchScope.ts";

const branches = [
  { id: 1, name: "Main branch", is_active: true },
  { id: 2, name: "Branch 2", is_active: true },
  { id: 3, name: "Old branch", is_active: false },
];

test("without see_other_branches the page is locked to the session branch and shows its name", () => {
  const r = resolveBranch({ canPick: false, sessionBranchId: 2, param: "1", branches });
  assert.deepEqual(r, { branchId: 2, canPick: false, locked: true, label: "Branch 2" });
  // No switcher even when the URL asks for another branch; a user without a branch sees "Your branch".
  assert.equal(resolveBranch({ canPick: false, sessionBranchId: null, param: null, branches }).label, "Your branch");
  assert.equal(resolveBranch({ canPick: false, sessionBranchId: null, param: null, branches }).branchId, null);
});

test("with see_other_branches the default is the user's own branch, else the first; ?branch= picks one", () => {
  const own = resolveBranch({ canPick: true, sessionBranchId: 1, param: null, branches });
  assert.deepEqual(own, { branchId: 1, canPick: true, locked: false, label: "Main branch" });
  // An admin without a branch lands on the first branch A-Z (never "all").
  const admin = resolveBranch({ canPick: true, sessionBranchId: null, param: null, branches });
  assert.deepEqual(admin, { branchId: 2, canPick: true, locked: false, label: "Branch 2" });
  const one = resolveBranch({ canPick: true, sessionBranchId: 1, param: "2", branches });
  assert.deepEqual(one, { branchId: 2, canPick: true, locked: false, label: "Branch 2" });
  // Unknown, inactive or malformed values fall back to the default branch.
  assert.equal(resolveBranch({ canPick: true, sessionBranchId: 1, param: "99", branches }).branchId, 1);
  assert.equal(resolveBranch({ canPick: true, sessionBranchId: 1, param: "3", branches }).branchId, 1);
  assert.equal(resolveBranch({ canPick: true, sessionBranchId: 1, param: "abc", branches }).branchId, 1);
  // Before the branch list loads there is nothing to pick yet.
  assert.equal(resolveBranch({ canPick: true, sessionBranchId: null, param: null, branches: [] }).branchId, null);
});

test("the drop-down lists active branches A-Z; branchParam is the id", () => {
  assert.deepEqual(branchOptions(branches).map((b) => b.name), ["Branch 2", "Main branch"]);
  assert.equal(branchParam(2), "2");
});

test('no "All branches" anywhere in the People screens', () => {
  const root = new URL("..", import.meta.url).pathname;
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "__tests__") walk(path);
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.startsWith("mock")) files.push(path);
    }
  };
  walk(root);
  assert.ok(files.length > 20);
  const offenders = files.filter((f) => /All branches|allowAll/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, []);
});
