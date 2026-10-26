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
export function DashboardHeader({ today }: { today: Today | null }) {
  const { branch, branches, canSwitch, setActiveBranch, switching } = useActiveBranch();
  return (
    <header className={styles.header}>
      <div className={styles.titleBlock}>
        <h1 className={styles.title}>
          Dashboard {branch ? <span className={styles.titleBranch}>· {branch.name}</span> : null}
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
              aria-selected={b.id === branch?.id}
              className={styles.tab}
              disabled={switching}
              onClick={() => void setActiveBranch(b.id)}
            >
              {b.name}
              <span className={styles.tabCount}>{b.staff}</span>
            </button>
          ))}
        </div>
      ) : null}
    </header>
  );
}

