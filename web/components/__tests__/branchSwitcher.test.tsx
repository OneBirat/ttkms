import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BranchSwitcher } from "../BranchSwitcher";
import { BranchContext, type ActiveBranchState } from "@/lib/branchContext";

const main = { id: 1, name: "Main branch" };
const options = [
  { id: 2, name: "Branch 2", staff: 12 },
  { id: 1, name: "Main branch", staff: 18 },
];

function state(over: Partial<ActiveBranchState> = {}): ActiveBranchState {
  return { branch: main, branches: options, canSwitch: true, setActiveBranch: async () => {}, switching: false, error: null, version: 0, ...over };
}

const render = (s: ActiveBranchState, variant?: "sidebar" | "bar") =>
  renderToStaticMarkup(createElement(BranchContext.Provider, { value: s }, createElement(BranchSwitcher, { variant })));

describe("sidebar branch switcher", () => {
  it("see_other_branches: a dark button - BRANCH, the name, ▾ - that opens a listbox", () => {
    const html = render(state());
    assert.match(html, /aria-haspopup="listbox"/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, />Branch<\/span><span[^>]*>Main branch</);
    assert.match(html, /title="Every page uses this branch until you change it\."/);
    assert.doesNotMatch(html, /role="listbox"/); // closed until clicked
  });

  it("staff: the same block with the branch name only - no ▾, no menu", () => {
    const html = render(state({ canSwitch: false, branches: [] }));
    assert.match(html, /data-testid="branch-name"/);
    assert.match(html, />Main branch</);
    assert.doesNotMatch(html, /<button|aria-haspopup|<select|M6 9l6 6 6-6/);
  });

  it("phone pill lists the branches with their staff", () => {
    const html = render(state(), "bar");
    assert.match(html, /<option value="2">Branch 2 · 12 staff<\/option><option value="1" selected="">Main branch · 18 staff<\/option>/);
  });
});
