"use client";

import { Icon } from "@/components/icons";
import type { User } from "@/lib/api";
import styles from "./UserFooter.module.css";

/** "Ram Bahadur Thapa" → "RT"; one word → its first two letters. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** "Admin · Main branch"; "Admin · all branches" without a branch but with see_other_branches. */
export function rolePlace(user: Pick<User, "role_label">, branchName: string | null, allBranches: boolean): string {
  if (branchName) return `${user.role_label} · ${branchName}`;
  return allBranches ? `${user.role_label} · all branches` : user.role_label;
}

/**
 * Bottom of the sidebar and the phone drawer (docs/design/ui-touch/Main.dc.html): initials,
 * full name, role · branch and Log out. Never scrolls away - the nav links scroll above it.
 */
export function UserFooter({
  user,
  place,
  onLogout,
}: {
  user: User;
  place: string;
  onLogout: () => void;
}) {
  return (
    <div className={styles.footer}>
      <span className={styles.avatar} aria-hidden="true">
        {initialsOf(user.full_name)}
      </span>
      <span className={styles.who}>
        <span className={styles.name}>{user.full_name}</span>
        <span className={styles.place}>{place}</span>
      </span>
      <button type="button" className={styles.logout} onClick={onLogout}>
        <Icon name="logout" size={15} />
        Log out
      </button>
    </div>
  );
}
