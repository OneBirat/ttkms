"use client";

import { createContext, useContext } from "react";
import type { ActiveBranch, BranchOption } from "@/lib/api";

/*
 * The active-branch context (provider: lib/branch.tsx BranchProvider, mounted by AppShell). Kept
 * apart from the provider so components and node tests can use it without the session / router.
 */

export interface ActiveBranchState {
  /** The ONE active branch; null only for a user without a branch who may not switch. */
  branch: ActiveBranch | null;
  /** Active branches A-Z with their staff (see_other_branches; empty for everyone else). */
  branches: BranchOption[];
  canSwitch: boolean;
  /** Make another branch the active one for the whole app (every page, every tab). */
  setActiveBranch: (branchId: number) => Promise<void>;
  switching: boolean;
  error: string | null;
  /** Goes up on every change of branch (this tab or another): pages keyed on it refetch. */
  version: number;
}

/** Kept for older call sites: the same state. */
export type BranchState = ActiveBranchState;

/** BroadcastChannel name the tabs share; the message is `{ branchId }`. */
export const BRANCH_CHANNEL = "ttk-active-branch";

/** "Dashboard · Main branch" - page titles name the branch they show. */
export function withBranch(title: string, branch: Pick<ActiveBranch, "name"> | null | undefined): string {
  return branch ? `${title} · ${branch.name}` : title;
}

/**
 * `?branch=<id>` in a URL: the branch to make active (when the user may see it) and the URL
 * without the param. `branch` is null when there is nothing to switch to (no param, not a
 * number, not allowed, or already active); `url` is null when there is no param to strip.
 */
export function branchFromUrl(
  href: string,
  state: { branchId: number | null; canSwitch: boolean; options: readonly { id: number }[] },
): { branch: number | null; url: string | null } {
  const url = new URL(href, "http://x");
  const raw = url.searchParams.get("branch");
  if (raw === null) return { branch: null, url: null };
  url.searchParams.delete("branch");
  const rest = url.searchParams.toString();
  const clean = `${url.pathname}${rest ? `?${rest}` : ""}${url.hash}`;
  const id = /^\d+$/.test(raw) ? Number(raw) : null;
  const allowed = id !== null && state.canSwitch && state.options.some((b) => b.id === id);
  return { branch: allowed && id !== state.branchId ? id : null, url: clean };
}

/** Exported for tests; screens use useActiveBranch(). */
export const BranchContext = createContext<ActiveBranchState | null>(null);

export function useActiveBranch(): ActiveBranchState {
  const state = useContext(BranchContext);
  if (!state) throw new Error("useActiveBranch must be used inside <BranchProvider> (AppShell).");
  return state;
}

/** Same as useActiveBranch (older name). */
export const useBranch = useActiveBranch;
