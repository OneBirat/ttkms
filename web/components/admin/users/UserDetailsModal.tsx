"use client";

import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { adDateTime, bsDateTime } from "../dates";
import { formatPhone, initials } from "../phone";
import { allowedCount, PERMISSION_GROUPS, PERMISSIONS } from "../permissions";
import type { AdminUser } from "../types";
import styles from "../components/admin.module.css";
import { ROLE_TONE } from "./roleTone";

export interface UserDetailsModalProps {
  user: AdminUser;
  onClose: () => void;
  onEditDetails: () => void;
  onEditAccess: () => void;
}

export function lastSignIn(user: AdminUser): string {
  if (!user.last_login_at) return "Never";
  return user.last_login_at_bs
    ? bsDateTime(user.last_login_at_bs, user.last_login_at)
    : adDateTime(user.last_login_at);
}

/** "View details & access" (design/final/AdminUsers.dc.html): every detail + every permission. */
export function UserDetailsModal({
  user,
  onClose,
  onEditDetails,
  onEditAccess,
}: UserDetailsModalProps) {
  const details: [string, string, boolean?][] = [
    ["Login (phone)", user.phone ? `+977 ${formatPhone(user.phone)}` : user.username, true],
    ["Branch", user.branch?.name ?? "All branches"],
    [
      "Linked employee",
      user.employee
        ? `${user.employee.code} · ${user.employee.full_name}${
            user.employee.department ? ` · ${user.employee.department}` : ""
          }`
        : "Not linked",
    ],
    ["Last sign-in", lastSignIn(user)],
    ["Role", `${user.role_label}${user.custom ? " (custom access)" : ""}`],
    [
      "Password",
      user.must_change_password
        ? "Temporary · must be changed at next sign-in"
        : "Set by user · reset from ⋮ menu",
    ],
  ];

  return (
    <Modal open title={user.full_name} onClose={onClose} size="sm">
      <div className={styles.form}>
        <div className={styles.vHead}>
          <span className={`${styles.avatar} ${styles.avatarLg}`} aria-hidden="true">
            {initials(user.full_name)}
          </span>
          <div className={styles.vHeadText}>
            <div className={styles.vTags}>
              <Pill status={ROLE_TONE[user.role]} label={user.role_label} />
              {user.custom ? <span className={styles.customTag}>Custom access</span> : null}
              <Pill status={user.is_active ? "active" : "inactive"} label={user.is_active ? "Active" : "Disabled"} />
            </div>
          </div>
        </div>
        <dl className={styles.vGrid}>
          {details.map(([key, value, mono]) => (
            <div key={key} className={styles.vItem}>
              <dt className={styles.vKey}>{key}</dt>
              <dd className={`${styles.vVal} ${mono ? "mono" : ""}`} style={{ margin: 0 }}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <div className={styles.vAccessHead}>
          <h3 className={styles.vAccessTitle}>Access provided</h3>
          <span className="muted" style={{ fontSize: 13 }}>
            {allowedCount(user.access)} of {PERMISSIONS.length} allowed
          </span>
        </div>
        {PERMISSION_GROUPS.map((group) => (
          <div key={group.title} className={styles.accessGroup}>
            <div className={styles.accessGroupTitle}>{group.title}</div>
            {group.items.map((item) => {
              const on = user.access[item.key];
              return (
                <div key={item.key} className={styles.vRow}>
                  <span
                    className={`${styles.vIco} ${on ? styles.accOn : styles.vIcoOff}`}
                    aria-hidden="true"
                  >
                    {on ? "✓" : "✕"}
                  </span>
                  <div className={styles.accessText}>
                    <span className={`${styles.accessLabel} ${on ? "" : styles.vOffText}`}>
                      {item.label}
                    </span>
                    <span className={styles.accessDesc}>{item.description}</span>
                  </div>
                  <span className={`${styles.vState} ${on ? "" : styles.vStateOff}`}>
                    {on ? "Allowed" : "No access"}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        <div className={styles.formFoot}>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn" onClick={onEditDetails}>
            Edit details
          </button>
          <button type="button" className="btn btn--primary" onClick={onEditAccess}>
            Edit access
          </button>
        </div>
      </div>
    </Modal>
  );
}
