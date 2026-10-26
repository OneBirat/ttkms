"use client";

import { useId } from "react";
import { Icon } from "@/components/icons";
import { useActiveBranch } from "@/lib/branchContext";
import styles from "./PageBranchSelect.module.css";

/**
 * The page-level "Branch" drop-down (Mark attendance, Attendance report, Employees, Payment
 * reports, Salary report). It holds no state of its own: it shows the ONE active branch and
 * changing it calls setActiveBranch, so the whole app (every page, every tab) moves with it -
 * the same as the sidebar switcher. Without `see_other_branches`: the branch name, locked.
 */
export function PageBranchSelect({ label = "Branch", hideLabel = false }: { label?: string; hideLabel?: boolean }) {
  const { branch, branches, canSwitch, switching, setActiveBranch } = useActiveBranch();
  const id = useId();
  if (!canSwitch || branches.length < 2) {
    return (
      <span className={styles.locked} data-testid="page-branch" title={canSwitch ? undefined : "Your branch"}>
        <Icon name="home" size={16} />
        {branch?.name ?? "No branch"}
        {canSwitch ? null : <span className={styles.sub}>· your branch</span>}
      </span>
    );
  }
  return (
    <label htmlFor={id} className={styles.label}>
      <span className={hideLabel ? "sr-only" : undefined}>{label}</span>
      <span className={styles.field}>
        <Icon name="home" size={16} />
        <select
          id={id}
          data-testid="page-branch-select"
          value={branch?.id ?? ""}
          disabled={switching}
          onChange={(e) => void setActiveBranch(Number(e.target.value))}
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} ({b.staff})
            </option>
          ))}
        </select>
        <span className={styles.caret} aria-hidden="true">
          <Icon name="chevron-down" size={16} />
        </span>
      </span>
    </label>
  );
}
