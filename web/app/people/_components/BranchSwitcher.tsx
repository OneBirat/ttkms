"use client";

import { Icon } from "@/components/icons";
import { ALL_BRANCHES } from "../_lib/branchScope";
import type { ReportBranch } from "../_lib/useBranchScope";
import styles from "./employees.module.css";
import shared from "./payroll.module.css";

/**
 * Desktop branch control of the report pages: a select ("All branches" + every branch) for users
 * with `see_other_branches`, otherwise a small locked label with the session branch's name.
 */
export function BranchSwitcher({ scope, id }: { scope: ReportBranch; id: string }) {
  if (!scope.picker) {
    return (
      <span className={styles.branchLock} data-testid="branch-lock">
        🔒 {scope.label} · your branch
      </span>
    );
  }
  const { value, options, onChange } = scope.picker;
  return (
    <label htmlFor={id} className={styles.branchLabel}>
      Branch
      <span className={`field ${shared.selectWrap} ${styles.branchField}`}>
        <Icon name="home" size={16} style={{ color: "var(--color-primary)" }} />
        <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}>
          <option value="">{ALL_BRANCHES}</option>
          {options.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}
