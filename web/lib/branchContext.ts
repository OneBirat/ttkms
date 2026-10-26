"use client";

import { createContext, useContext } from "react";
import type { ActiveBranch } from "@/lib/api";

/*
 * The active-branch context (provider: lib/branch.tsx BranchProvider, mounted by AppShell). Kept
 * apart from the provider so components and node tests can use it without the session.
 */

export interface BranchState {
  /** The active branch; null only for a user without a branch who may not switch. */
  branch: ActiveBranch | null;
  /** Active branches A-Z to switch to (empty without `see_other_branches`). */
  branches: ActiveBranch[];
  canSwitch: boolean;
  switching: boolean;
  error: string | null;
  /** Goes up on every change of branch (this tab or another): pages keyed on it refetch. */
  version: number;
  switchTo: (branchId: number) => Promise<void>;
}

/** BroadcastChannel name the tabs share; the message is `{ branchId }`. */
export const BRANCH_CHANNEL = "ttk-active-branch";

export interface BranchRow {
  id: number;
  name: string;
  is_active: boolean;
}

/** Active branches, A-Z by name. */
export function activeBranchesAZ(rows: readonly BranchRow[]): ActiveBranch[] {
  return rows
    .filter((b) => b.is_active)
    .map((b) => ({ id: b.id, name: b.name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
}

/** "Dashboard · Main branch" - page titles name the branch they show. */
export function withBranch(title: string, branch: Pick<ActiveBranch, "name"> | null | undefined): string {
  return branch ? `${title} · ${branch.name}` : title;
}

/** Exported for tests; screens use useBranch(). */
export const BranchContext = createContext<BranchState | null>(null);

export function useBranch(): BranchState {
  const state = useContext(BranchContext);
  if (!state) throw new Error("useBranch must be used inside <BranchProvider> (AppShell).");
  return state;
}
