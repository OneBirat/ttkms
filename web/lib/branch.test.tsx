import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BranchSwitcher } from "@/components/BranchSwitcher";
import { BranchContext, activeBranchesAZ, withBranch, type BranchState } from "./branchContext";

const main = { id: 1, name: "Main branch" };
const second = { id: 2, name: "Branch 2" };

function state(over: Partial<BranchState> = {}): BranchState {
  return {
    branch: main,
    branches: [second, main],
    canSwitch: true,
    switching: false,
    error: null,
    version: 0,
    switchTo: async () => {},
    ...over,
  };
}

const render = (s: BranchState, variant?: "sidebar" | "bar") =>
  renderToStaticMarkup(createElement(BranchContext.Provider, { value: s }, createElement(BranchSwitcher, { variant })));

describe("active branch", () => {
  it("switcher lists the active branches A-Z", () => {
    assert.deepEqual(
      activeBranchesAZ([
        { id: 1, name: "Main branch", is_active: true },
        { id: 3, name: "Old shop", is_active: false },
        { id: 2, name: "Branch 2", is_active: true },
      ]),
      [second, main],
    );
  });

  it("page titles name the branch", () => {
    assert.equal(withBranch("Dashboard", main), "Dashboard · Main branch");
    assert.equal(withBranch("Dashboard", null), "Dashboard");
  });

  it("see_other_branches: a dropdown on the active branch", () => {
    const html = render(state());
    assert.match(html, /data-testid="branch-switcher"/);
    assert.match(html, /<option value="2">Branch 2<\/option><option value="1" selected="">Main branch<\/option>/);
    assert.match(html, /Main branch/);
  });

  it("without it: the branch name, nothing to open", () => {
    const html = render(state({ canSwitch: false, branches: [main] }), "bar");
    assert.doesNotMatch(html, /<select/);
    assert.match(html, /data-testid="branch-name"/);
    assert.match(html, />Main branch</);
  });

  it("while switching the pill says so", () => {
    assert.match(render(state({ switching: true })), /Switching…/);
  });
});
