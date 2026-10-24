"use client";

import { useState } from "react";
import { useSession } from "@/lib/session";
import type { Branch } from "../types";

export interface BranchScope {
  /** The branch the screen shows; null = every branch (an admin before any pick, no branches yet). */
  active: number | null;
  /** True when the user holds `see_other_branches` and may switch. */
  canPick: boolean;
  /** Props for the branch drop-down, or null when the user may not switch. */
  picker: { value: number | null; options: Branch[]; onChange: (id: number) => void } | null;
}

/**
 * Which branch a People screen shows. Everyone starts on their own branch
 * (session.branchId from admin.user_access); only users with
 * `see_other_branches` get the drop-down, and for them an unassigned branch
 * (admins) falls back to the first one so the picker always has a value.
 */
export function useBranchScope(branches: Branch[]): BranchScope {
  const { branchId, can } = useSession();
  const [picked, setPicked] = useState<number | null>(null);
  const canPick = can("see_other_branches");
  const active = canPick ? (picked ?? branchId ?? branches[0]?.id ?? null) : branchId;
  return {
    active,
    canPick,
    picker: canPick ? { value: active, options: branches, onChange: setPicked } : null,
  };
}
