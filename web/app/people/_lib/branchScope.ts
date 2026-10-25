/**
 * Which branch a report shows (Payment reports, Salary report) - pure rules, tested in
 * __tests__/branchScope.test.mjs; `useReportBranch` in useBranchScope.ts wires them to the
 * session and the URL (?branch=).
 *
 * - With `see_other_branches`: a switcher with "All branches" + every branch; default All.
 * - Without it: no switcher, the page is locked to the session's branch and shows its name.
 */

import type { Branch } from "../types";

export interface BranchResolution {
  /** Branch to query; null = all branches. */
  branchId: number | null;
  /** True when the user may switch (the switcher is shown). */
  canPick: boolean;
  /** True when the page is pinned to the session branch (no switcher, a label instead). */
  locked: boolean;
  /** "All branches", "Main branch", or "Your branch" when the session has none yet. */
  label: string;
}

export const ALL_BRANCHES = "All branches";

export function resolveBranch(input: {
  canPick: boolean;
  sessionBranchId: number | null;
  /** The ?branch= value, if any. */
  param: string | null | undefined;
  branches: readonly Branch[];
}): BranchResolution {
  const { canPick, sessionBranchId, param, branches } = input;
  if (!canPick) {
    const own = branches.find((b) => b.id === sessionBranchId);
    return { branchId: sessionBranchId, canPick: false, locked: true, label: own?.name ?? (sessionBranchId === null ? "Your branch" : `Branch ${sessionBranchId}`) };
  }
  const id = param && /^\d+$/.test(param) ? Number(param) : null;
  const picked = id !== null ? branches.find((b) => b.id === id) ?? null : null;
  // An unknown ?branch= (or none) means every branch, the default for people who may switch.
  return { branchId: picked?.id ?? null, canPick: true, locked: false, label: picked?.name ?? ALL_BRANCHES };
}

/** The ?branch= value for a pick: null (remove) for All branches. */
export function branchParam(id: number | null): string | null {
  return id === null ? null : String(id);
}
