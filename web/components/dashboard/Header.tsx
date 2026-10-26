"use client";

import { DateLine } from "@/components/DateLine";
import type { Today } from "@/lib/api";
import { useActiveBranch } from "@/lib/branchContext";
import styles from "../Dashboard.module.css";

/**
 * "Dashboard · {Branch}" (the branch part in grey), today's date (BS first, EN/ने toggle) and, for
 * users with see_other_branches, the segmented control on the right: one tab per active branch A-Z
 * with its staff - a tab makes that branch the active one for the whole app.
 */
export interface DashboardHeaderProps {
  today: Today | null;
  /** "Compare branches" is showing (?view=compare). */
  compare?: boolean;
  /** A branch tab: make it the active branch (and show its view). */
  onBranch?: (id: number) => void;
  onCompare?: () => void;
}

export function DashboardHeader({ today, compare = false, onBranch, onCompare }: DashboardHeaderProps) {
  const { branch, branches, canSwitch, setActiveBranch, switching } = useActiveBranch();
  const pick = onBranch ?? ((id: number) => void setActiveBranch(id));
  return (
    <header className={styles.header}>
      <div className={styles.titleBlock}>
        <h1 className={styles.title}>
          Dashboard{" "}
          {compare ? (
            <span className={styles.titleBranch}>· compare branches</span>
          ) : branch ? (
            <span className={styles.titleBranch}>· {branch.name}</span>
          ) : null}
        </h1>
        <DateLine today={today} />
      </div>
      {canSwitch && branches.length > 1 ? (
        <div role="tablist" aria-label="Active branch" className={styles.tabs} data-testid="branch-tabs">
          {branches.map((b) => (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={!compare && b.id === branch?.id}
              className={styles.tab}
              disabled={switching}
              onClick={() => pick(b.id)}
            >
              {b.name}
              <span className={styles.tabCount}>{b.staff}</span>
            </button>
          ))}
          <button type="button" role="tab" aria-selected={compare} className={styles.tab} onClick={onCompare} data-testid="compare-tab">
            Compare branches
          </button>
        </div>
      ) : null}
    </header>
  );
}
