import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { branchFromUrl, withBranch } from "./branchContext";

const options = [
  { id: 2, name: "Branch 2", staff: 12 },
  { id: 1, name: "Main branch", staff: 18 },
];

describe("active branch", () => {
  it("page titles name the branch", () => {
    assert.equal(withBranch("Dashboard", { name: "Main branch" }), "Dashboard · Main branch");
    assert.equal(withBranch("Dashboard", null), "Dashboard");
  });

  it("?branch= is applied once (when allowed) and removed from the URL", () => {
    const admin = { branchId: 1, canSwitch: true, options };
    assert.deepEqual(branchFromUrl("http://h/people/payments?branch=2&dept=3#top", admin), {
      branch: 2,
      url: "/people/payments?dept=3#top",
    });
    // Already active, unknown, not a number: nothing to switch, the param still goes.
    assert.deepEqual(branchFromUrl("http://h/?branch=1", admin), { branch: null, url: "/" });
    assert.deepEqual(branchFromUrl("http://h/?branch=9", admin), { branch: null, url: "/" });
    assert.deepEqual(branchFromUrl("http://h/x?branch=abc&a=1", admin), { branch: null, url: "/x?a=1" });
    // No param: nothing to do (the effect then never touches the URL again).
    assert.deepEqual(branchFromUrl("http://h/people/payments?dept=3", admin), { branch: null, url: null });
    // Staff may not switch: the param is just removed.
    const staff = { branchId: 1, canSwitch: false, options: [] };
    assert.deepEqual(branchFromUrl("http://h/?branch=2", staff), { branch: null, url: "/" });
  });
});
