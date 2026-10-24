"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { errorMessage } from "@/lib/api";
import { AdminGate } from "../components/AdminGate";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Switch } from "../components/Switch";
import { Toast, useToast } from "../components/Toast";
import { useLoader } from "../components/useLoader";
import { canDeactivate } from "../guards";
import { formatPhone, initials } from "../phone";
import {
  allowedCount,
  changedKeys,
  PERMISSION_GROUPS,
  PERMISSIONS,
  ROLE_LABELS,
} from "../permissions";
import { listUsers, resetPassword, setUserActive, userOptions } from "../usersApi";
import { ROLES, type AdminUser, type Role } from "../types";
import { PHONE_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import styles from "../components/admin.module.css";
import { ROLE_TONE } from "./roleTone";
import { TempPasswordDialog } from "./TempPasswordDialog";
import { UserDetailsModal, lastSignIn } from "./UserDetailsModal";
import { UserForm, type UserFormMode } from "./UserForm";
import { UserMenu } from "./UserMenu";

const SUBTITLE =
  "Who can sign in, what they can do, and which branch they work in. Only admins see this page.";

type TableMode = "details" | "access";

interface Pin {
  title: string;
  who: string;
  password: string;
}

export function UsersPage() {
  return (
    <AdminGate page="users" title="Users & roles" subtitle={SUBTITLE}>
      {() => <UsersScreen />}
    </AdminGate>
  );
}

function matches(user: AdminUser, q: string): boolean {
  if (!q) return true;
  const hay = `${user.full_name} ${user.phone ?? ""} ${user.username}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

function UsersScreen() {
  const isPhone = useMediaQuery(PHONE_QUERY);
  const users = useLoader(listUsers);
  const options = useLoader(userOptions);
  const { toast, show, dismiss } = useToast();

  const [q, setQ] = useState("");
  const [mode, setMode] = useState<TableMode>("details");
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");
  const [view, setView] = useState<AdminUser | null>(null);
  const [form, setForm] = useState<UserFormMode | null>(null);
  const [resetFor, setResetFor] = useState<AdminUser | null>(null);
  const [pin, setPin] = useState<Pin | null>(null);

  const all = useMemo(() => users.data ?? [], [users.data]);
  const list = useMemo(
    () =>
      all.filter(
        (user) => matches(user, q) && (!isPhone || roleFilter === "all" || user.role === roleFilter),
      ),
    [all, q, isPhone, roleFilter],
  );

  const activeN = all.filter((u) => u.is_active).length;
  const count = (role: Role) => all.filter((u) => u.role === role && u.is_active).length;
  const tiles = [
    { label: "Active users", value: activeN, sub: `${all.length - activeN} disabled` },
    { label: "Admins", value: count("admin"), sub: "Full access" },
    { label: "Managers", value: count("manager"), sub: "Run a branch" },
    { label: "Staff", value: count("staff"), sub: "Daily entry only" },
  ];

  const replace = (updated: AdminUser) =>
    users.setData((current) =>
      current ? current.map((u) => (u.id === updated.id ? updated : u)) : current,
    );

  const toggleActive = async (user: AdminUser) => {
    try {
      const updated = await setUserActive(user.id, !user.is_active);
      replace(updated);
      show(`${updated.full_name} ${updated.is_active ? "enabled" : "disabled"}.`);
    } catch (err) {
      show(errorMessage(err), "danger");
    }
  };

  const runReset = async () => {
    if (!resetFor) return;
    const result = await resetPassword(resetFor.id);
    setResetFor(null);
    setPin({ title: "Password reset", who: result.full_name, password: result.temporary_password });
    users.reload();
  };

  const openEdit = (user: AdminUser, tab: "details" | "access" = "details") => {
    setView(null);
    setForm({ kind: "edit", user, tab });
  };

  const accessHeads = PERMISSION_GROUPS.flatMap((group) =>
    group.items.map((item) => ({ group: group.title, label: item.label, key: item.key })),
  );

  const header = (
    <PageHeader
      title="Users & roles"
      subtitle={isPhone ? "Admin only" : SUBTITLE}
      actions={
        isPhone ? undefined : (
          <button type="button" className="btn btn--primary" onClick={() => setForm({ kind: "create" })}>
            <Icon name="plus" size={16} strokeWidth={2.2} />
            Add user
          </button>
        )
      }
    />
  );

  const loadError = users.error ? (
    <EmptyState icon="alert" title="Could not load users" text={errorMessage(users.error)}>
      <button type="button" className="btn" onClick={users.reload}>
        Try again
      </button>
    </EmptyState>
  ) : null;

  const dialogs = (
    <>
      {form && options.data ? (
        <UserForm
          mode={form}
          options={options.data}
          users={all}
          layout={isPhone ? "sheet" : "modal"}
          onClose={() => setForm(null)}
          onCreated={(result) => {
            setForm(null);
            users.reload();
            options.reload();
            setPin({
              title: "User created",
              who: result.user.full_name,
              password: result.temporary_password,
            });
          }}
          onUpdated={(updated) => {
            setForm(null);
            replace(updated);
            options.reload();
            show(`${updated.full_name} saved.`);
          }}
        />
      ) : null}
      {view ? (
        <UserDetailsModal
          user={view}
          onClose={() => setView(null)}
          onEditDetails={() => openEdit(view, "details")}
          onEditAccess={() => openEdit(view, "access")}
        />
      ) : null}
      <ConfirmDialog
        open={resetFor !== null}
        title="Reset password?"
        confirmLabel="Reset password"
        onConfirm={runReset}
        onClose={() => setResetFor(null)}
      >
        <p>
          <strong>{resetFor?.full_name}</strong> gets a temporary password shown once; their
          current password stops working immediately and they set a new one at next sign-in.
        </p>
      </ConfirmDialog>
      {pin ? (
        <TempPasswordDialog
          title={pin.title}
          who={pin.who}
          password={pin.password}
          onClose={() => setPin(null)}
        />
      ) : null}
      <Toast toast={toast} onDismiss={dismiss} />
    </>
  );

  if (isPhone) {
    return (
      <div className={styles.stack}>
        {header}
        <div className={styles.mTiles} aria-label="Summary">
          {tiles.map((tile) => (
            <div key={tile.label} className={styles.mTile}>
              <span className={styles.mTileLabel}>{tile.label}</span>
              <span className={styles.mTileValue}>{tile.value}</span>
            </div>
          ))}
        </div>
        <div className="field">
          <Icon name="search" size={18} />
          <input
            type="search"
            aria-label="Search users"
            placeholder="Search name or phone"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
        </div>
        <div className={styles.chips} role="group" aria-label="Filter by role">
          {(["all", ...ROLES] as const).map((role) => (
            <button
              key={role}
              type="button"
              className={styles.chip}
              aria-pressed={roleFilter === role}
              onClick={() => setRoleFilter(role)}
            >
              {role === "all" ? "All" : ROLE_LABELS[role]} ·{" "}
              {role === "all" ? all.length : all.filter((u) => u.role === role).length}
            </button>
          ))}
        </div>
        {loadError ?? (
          <>
            <span className={styles.mCount} role="status">
              {users.loading ? "Loading users…" : `${list.length} users · tap a card to edit`}
            </span>
            <div className={styles.mList}>
              {list.map((user) => (
                <article
                  key={user.id}
                  className={`card ${styles.mCard} ${user.is_active ? "" : styles.rowOff}`}
                >
                  <div className={styles.mCardTop}>
                    <button
                      type="button"
                      className={styles.mCardBtn}
                      aria-label={`Edit ${user.full_name}`}
                      onClick={() => openEdit(user)}
                    >
                      <span
                        className={`${styles.avatar} ${styles.mAvatar} ${user.is_active ? "" : styles.avatarOff}`}
                        aria-hidden="true"
                      >
                        {initials(user.full_name)}
                      </span>
                      <span className={styles.userText}>
                        <span className={styles.mName}>
                          {user.full_name}
                          {user.is_you ? <span className={styles.you}>· You</span> : null}
                        </span>
                        <span className={styles.mPhone}>
                          {user.phone ? formatPhone(user.phone) : user.username}
                        </span>
                      </span>
                    </button>
                    <Switch
                      checked={user.is_active}
                      onChange={() => void toggleActive(user)}
                      label={`${user.is_active ? "Disable" : "Enable"} ${user.full_name}`}
                      disabled={user.is_you || Boolean(canDeactivate(all, user, -1) && user.is_active)}
                      title={user.is_you ? "You cannot disable your own account." : undefined}
                    />
                  </div>
                  <div className={styles.mMeta}>
                    <Pill status={ROLE_TONE[user.role]} label={user.role_label} />
                    {user.custom ? <span className={styles.customTag}>Custom</span> : null}
                    <span>· {user.branch?.name ?? "All branches"}</span>
                    <span className={styles.mLast}>{lastSignIn(user)}</span>
                  </div>
                  <div className={styles.mActions}>
                    <button type="button" className={styles.mAction} onClick={() => openEdit(user)}>
                      Edit
                    </button>
                    <button type="button" className={styles.mAction} onClick={() => setResetFor(user)}>
                      Reset password
                    </button>
                  </div>
                </article>
              ))}
              {!users.loading && list.length === 0 ? (
                <p className={styles.noMatch} style={{ textAlign: "center" }}>
                  No users match.
                </p>
              ) : null}
            </div>
          </>
        )}
        <button type="button" className={styles.fab} onClick={() => setForm({ kind: "create" })}>
          <Icon name="plus" size={18} strokeWidth={2.4} />
          Add user
        </button>
        {dialogs}
      </div>
    );
  }

  return (
    <div className={styles.stack}>
      {header}
      <section aria-label="Summary" className={styles.tiles}>
        {tiles.map((tile) => (
          <div key={tile.label} className={`card ${styles.tile}`}>
            <span className={styles.tileLabel}>{tile.label}</span>
            <span className={styles.tileValue}>{tile.value}</span>
            <span className={styles.tileSub}>{tile.sub}</span>
          </div>
        ))}
      </section>

      <section aria-labelledby="users-heading" className={`card ${styles.usersCard}`}>
        <div className={styles.usersHead}>
          <h2 id="users-heading" className={styles.usersTitle}>
            Users · {list.length}
          </h2>
          <div className={`field ${styles.searchField}`}>
            <Icon name="search" size={16} strokeWidth={2} />
            <input
              type="search"
              aria-label="Search users"
              placeholder="Search name or phone"
              value={q}
              onChange={(event) => setQ(event.target.value)}
            />
          </div>
          <button
            type="button"
            className={styles.modeBtn}
            aria-pressed={mode === "access"}
            onClick={() => setMode(mode === "access" ? "details" : "access")}
          >
            <Icon name={mode === "access" ? "table" : "shield-check"} size={16} strokeWidth={2} />
            {mode === "access" ? "View details" : "View access"}
          </button>
        </div>

        {loadError ?? (
          <div className={styles.tblWrap}>
            <table className={styles.tbl}>
              <thead>
                <tr>
                  <th scope="col">User</th>
                  {mode === "details" ? (
                    <>
                      <th scope="col">Login (phone)</th>
                      <th scope="col">Branch</th>
                      <th scope="col">Linked employee</th>
                      <th scope="col">Last sign-in</th>
                      <th scope="col">Status</th>
                    </>
                  ) : (
                    <>
                      {accessHeads.map((head) => (
                        <th key={head.key} scope="col" className={`${styles.tblCenter} ${styles.accHead}`}>
                          <span className={styles.accHeadGroup}>{head.group}</span>
                          {head.label}
                        </th>
                      ))}
                      <th scope="col" className={styles.tblCenter}>
                        Total
                      </th>
                    </>
                  )}
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((user) => {
                  const diff = new Set(changedKeys(user.role, user.access));
                  const blocked = user.is_active ? canDeactivate(all, user, user.is_you ? user.id : -1) : null;
                  return (
                    <tr key={user.id} className={user.is_active ? undefined : styles.rowOff}>
                      <td>
                        <div className={styles.userCell}>
                          <span
                            className={`${styles.avatar} ${user.is_active ? "" : styles.avatarOff}`}
                            aria-hidden="true"
                          >
                            {initials(user.full_name)}
                          </span>
                          <div className={styles.userText}>
                            <span className={styles.userName}>
                              {user.full_name}
                              {user.is_you ? <span className={styles.you}>(You)</span> : null}
                            </span>
                            <span className={styles.roleLine}>
                              <Pill
                                status={ROLE_TONE[user.role]}
                                label={user.role_label}
                                className={styles.rolePill}
                              />
                              {user.custom ? <span className={styles.customTag}>Custom</span> : null}
                            </span>
                          </div>
                          <UserMenu
                            user={user}
                            onView={() => setView(user)}
                            onAccess={() => openEdit(user, "access")}
                            onReset={() => setResetFor(user)}
                            onEdit={() => openEdit(user)}
                          />
                        </div>
                      </td>
                      {mode === "details" ? (
                        <>
                          <td className={styles.phoneCell}>
                            {user.phone ? formatPhone(user.phone) : <span className="muted">{user.username}</span>}
                          </td>
                          <td>{user.branch?.name ?? "All branches"}</td>
                          <td className={styles.empCell}>
                            {user.employee
                              ? `${user.employee.code} · ${user.employee.department ?? user.employee.full_name}`
                              : "—"}
                          </td>
                          <td className={styles.lastCell}>{lastSignIn(user)}</td>
                          <td>
                            <Switch
                              checked={user.is_active}
                              onChange={() => void toggleActive(user)}
                              label={`${user.is_active ? "Disable" : "Enable"} ${user.full_name}`}
                              disabled={Boolean(blocked)}
                              title={blocked ?? undefined}
                            />
                          </td>
                        </>
                      ) : (
                        <>
                          {PERMISSIONS.map((key) => {
                            const on = user.access[key];
                            return (
                              <td key={key} className={styles.tblCenter}>
                                <span
                                  className={`${styles.accCell} ${on ? styles.accOn : styles.accOff} ${
                                    diff.has(key) ? styles.accDiff : ""
                                  }`}
                                  role="img"
                                  aria-label={`${head(accessHeads, key)}: ${on ? "allowed" : "no access"}${
                                    diff.has(key) ? " (differs from role)" : ""
                                  }`}
                                >
                                  {on ? "✓" : "✕"}
                                </span>
                              </td>
                            );
                          })}
                          <td className={`${styles.tblCenter} ${styles.totalCell}`}>
                            {allowedCount(user.access)}/{PERMISSIONS.length}
                          </td>
                        </>
                      )}
                      <td className={styles.cellEnd}>
                        <button type="button" className={styles.editBtn} onClick={() => openEdit(user)}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {users.loading ? (
              <p className={styles.noMatch} role="status">
                Loading users…
              </p>
            ) : list.length === 0 ? (
              <p className={styles.noMatch}>No users match.</p>
            ) : null}
          </div>
        )}
      </section>
      {dialogs}
    </div>
  );
}

function head(heads: { key: string; label: string }[], key: string): string {
  return heads.find((h) => h.key === key)?.label ?? key;
}
