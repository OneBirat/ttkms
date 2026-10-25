"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { useSession } from "@/lib/session";
import { branchParam, resolveBranch, type BranchResolution } from "./branchScope";
import type { Branch } from "../types";

export interface BranchPicker {
  value: number | null;
  options: Branch[];
  onChange: (id: number | null) => void;
  /** Offer "All branches" (value null) as the first option. */
  allowAll?: boolean;
}

export interface BranchScope {
  /** The branch the screen shows; null = every branch (an admin before any pick, no branches yet). */
  active: number | null;
  /** True when the user holds `see_other_branches` and may switch. */
  canPick: boolean;
  /** Props for the branch drop-down, or null when the user may not switch. */
  picker: BranchPicker | null;
}

/**
 * Which branch a People *list* screen shows (Employees). Everyone starts on their own branch
 * (session.branchId from admin.user_access); only users with `see_other_branches` get the
 * drop-down, and for them an unassigned branch (admins) falls back to the first one so the
 * picker always has a value.
 */
export function useBranchScope(branches: Branch[]): BranchScope {
  const { branchId, can } = useSession();
  const [picked, setPicked] = useState<number | null>(null);
  const canPick = can("see_other_branches");
  const active = canPick ? (picked ?? branchId ?? branches[0]?.id ?? null) : branchId;
  return {
    active,
    canPick,
    picker: canPick ? { value: active, options: branches, onChange: (id) => setPicked(id ?? branches[0]?.id ?? null) } : null,
  };
}

export interface ReportBranch extends BranchResolution {
  /** Props for the switcher (desktop select / phone pill), or null when locked. */
  picker: BranchPicker | null;
  /** Change the branch (null = All branches); writes ?branch= and drops the page number. */
  setBranch: (id: number | null) => void;
}

/**
 * Which branch a *report* shows (Payment reports, Salary report): rules in branchScope.ts,
 * kept in the URL as ?branch= next to ?dept=&sort=. Users with `see_other_branches` default to
 * All branches; everyone else is locked to their own branch.
 */
export function useReportBranch(branches: Branch[]): ReportBranch {
  const { branchId, can } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const resolved = resolveBranch({ canPick: can("see_other_branches"), sessionBranchId: branchId, param: params.get("branch"), branches });
  const setBranch = useCallback(
    (id: number | null) => {
      const next = new URLSearchParams(params.toString());
      const value = branchParam(id);
      if (value === null) next.delete("branch");
      else next.set("branch", value);
      next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  return {
    ...resolved,
    setBranch,
    picker: resolved.canPick ? { value: resolved.branchId, options: branches, onChange: setBranch, allowAll: true } : null,
  };
}
