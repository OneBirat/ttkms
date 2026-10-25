"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { useSession } from "@/lib/session";
import { branchOptions, branchParam, resolveBranch, type BranchResolution } from "./branchScope";
import type { Branch } from "../types";

export interface BranchPicker {
  value: number | null;
  /** Active branches A-Z. */
  options: Branch[];
  onChange: (id: number) => void;
}

export interface ReportBranch extends BranchResolution {
  /** Props for the drop-down (desktop select / phone pill), or null when locked. */
  picker: BranchPicker | null;
  /** Change the branch; writes ?branch= and drops the page number. */
  setBranch: (id: number) => void;
  /** False while the branch list is still loading for a user who may switch: wait before querying. */
  ready: boolean;
}

/** A load that never settles: keeps a screen on "Loading…" until its branch is known. */
export function waitForBranch<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

/**
 * Which branch a People screen shows (Employees, Payment reports, Salary report): rules in
 * branchScope.ts, kept in the URL as ?branch=. Users with `see_other_branches` default to their
 * own branch (else the first one); everyone else is locked to their own branch.
 */
export function useReportBranch(branches: Branch[]): ReportBranch {
  const { branchId, can } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const resolved = resolveBranch({ canPick: can("see_other_branches"), sessionBranchId: branchId, param: params.get("branch"), branches });
  const setBranch = useCallback(
    (id: number) => {
      const next = new URLSearchParams(params.toString());
      next.set("branch", branchParam(id));
      next.delete("page");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );
  return {
    ...resolved,
    setBranch,
    ready: resolved.locked || resolved.branchId !== null,
    picker: resolved.canPick ? { value: resolved.branchId, options: branchOptions(branches), onChange: setBranch } : null,
  };
}
