/**
 * Which branch a People screen shows (Employees, Payment reports, Salary report) - pure rules,
 * tested in __tests__/branchScope.test.mjs; `useReportBranch` in useBranchScope.ts wires them to
 * the session and the URL (?branch=). Always exactly one branch, never "all".
 *
 * - With `see_other_branches`: a drop-down of every active branch A-Z; default = the session's
 *   own branch, else the first branch. ?branch= picks another one.
 * - Without it: no drop-down, the page is locked to the session's branch and shows its name.
 */

import type { Branch } from "../types";

export interface BranchResolution {
  /** Branch to query; null only while the branch list is loading (or a locked user has none). */
  branchId: number | null;
  /** True when the user may switch (the drop-down is shown). */
  canPick: boolean;
  /** True when the page is pinned to the session branch (no drop-down, a label instead). */
  locked: boolean;
  /** "Main branch", or "Your branch" when the session has none yet. */
  label: string;
}

/** The drop-down's options: active branches A-Z. */
export function branchOptions(branches: readonly Branch[]): Branch[] {
  return branches.filter((b) => b.is_active).sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
}

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
  const options = branchOptions(branches);
  const id = param && /^\d+$/.test(param) ? Number(param) : null;
  // An unknown ?branch= (or none) falls back to the user's own branch, else the first one.
  const picked = options.find((b) => b.id === id) ?? options.find((b) => b.id === sessionBranchId) ?? options[0] ?? null;
  return { branchId: picked?.id ?? null, canPick: true, locked: false, label: picked?.name ?? "Branch" };
}

/** The ?branch= value for a pick. */
export function branchParam(id: number): string {
  return String(id);
}
