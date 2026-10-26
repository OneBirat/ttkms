"use client";

import { useActiveBranch } from "@/lib/branchContext";

/**
 * Which branch a People screen shows (Employees, Payment reports, Salary report): the ONE active
 * branch of the whole app (lib/branch.tsx), switched in the shell only - no page drop-down, no
 * ?branch=. The server already scopes every request to it, so screens send no branch; they use
 * this for titles and labels. Switching remounts the page (AppShell), which refetches.
 */
export interface ReportBranch {
  branchId: number | null;
  /** "Main branch" ("Your branch" for a user without one). */
  label: string;
}

export function useReportBranch(): ReportBranch {
  const { branch } = useActiveBranch();
  return { branchId: branch?.id ?? null, label: branch?.name ?? "Your branch" };
}
