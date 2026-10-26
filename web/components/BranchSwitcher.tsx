"use client";

import { Icon } from "@/components/icons";
import { useBranch } from "@/lib/branchContext";
import styles from "./BranchSwitcher.module.css";

/**
 * The ONE place the active branch is picked (lib/branch.tsx): "🏠 Main branch ▾" under the logo
 * in the sidebar, in the phone drawer and in the phone top bar ("bar"). The list is every active
 * branch A-Z; switching refetches the page here and in every other open tab. Without
 * `see_other_branches` it is just the branch's name - nothing to open.
 */
export function BranchSwitcher({ variant = "sidebar" }: { variant?: "sidebar" | "bar" }) {
  const { branch, branches, canSwitch, switching, error, switchTo } = useBranch();
  const name = branch?.name ?? "No branch";
  if (!canSwitch || branches.length < 2) {
    return (
      <div className={styles.branch} data-variant={variant} data-locked="true" data-testid="branch-name" title={canSwitch ? undefined : "Your branch"}>
        <Icon name="home" size={16} />
        <span className={styles.name}>{name}</span>
      </div>
    );
  }
  return (
    <div className={styles.wrap} data-variant={variant}>
      <label className={styles.branch} data-variant={variant} data-busy={switching || undefined}>
        <Icon name="home" size={16} />
        <span className={styles.name}>{switching ? "Switching…" : name}</span>
        <span className={styles.caret} aria-hidden="true">
          <Icon name="chevron-down" size={16} />
        </span>
        <select
          aria-label="Active branch"
          data-testid="branch-switcher"
          value={branch?.id ?? ""}
          disabled={switching}
          onChange={(e) => void switchTo(Number(e.target.value))}
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
