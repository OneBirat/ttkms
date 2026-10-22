"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import {
  listBranches,
  listEmployees,
  listUsers,
  resetPassword,
  setUserActive,
} from "../api";
import { canDeactivate } from "../guards";
import { ROLE_LABELS } from "../permissions";
import {
  ROLES,
  type AdminUser,
  type OneTimePassword,
  type Role,
  type UserStatusFilter,
} from "../types";
import { adDateTime, bsDateTime } from "../dates";
import { AdminGate } from "../components/AdminGate";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Select } from "../components/Field";
import { OneTimePasswordBox } from "../components/OneTimePasswordBox";
import { Toast, useToast } from "../components/Toast";
import { useLoader } from "../components/useLoader";
import { RolesMatrix } from "./RolesMatrix";
import { UserDialog, type UserDialogMode } from "./UserDialog";
import styles from "../components/admin.module.css";

const ROLE_TONE: Record<Role, string> = {
  admin: "info",
  manager: "ok",
  store_keeper: "pending",
  staff: "staff",
};

const COLUMNS: Column[] = [
  { key: "user", label: "User" },
  { key: "employee", label: "Linked employee" },
  { key: "role", label: "Role" },
  { key: "branches", label: "Branch access" },
  { key: "last_login", label: "Last sign-in" },
  { key: "status", label: "Status" },
  { key: "actions", label: "Actions", align: "right" },
];

type PendingAction =
  | { kind: "reset"; user: AdminUser }
  | { kind: "deactivate"; user: AdminUser }
  | { kind: "activate"; user: AdminUser };

export function UsersPage() {
  return (
    <AdminGate
      page="users"
      title="Users & roles"
      subtitle="Who can sign in, and what each role can open."
    >
      {() => <UsersScreen />}
    </AdminGate>
  );
}

function UsersScreen() {
  const { user: me } = useSession();
  const actorId = me?.id ?? 0;
  const { toast, show, dismiss } = useToast();

  const [q, setQ] = useState("");
  const [role, setRole] = useState<Role | "">("");
  const [status, setStatus] = useState<UserStatusFilter>("all");
  const filterKey = JSON.stringify({ q, role, status });

  const users = useLoader(() => listUsers({ q, role, status }), filterKey);
  const allUsers = useLoader(() => listUsers({ status: "all" }), "all");
  const employees = useLoader(listEmployees);
  const branches = useLoader(listBranches);

  const [dialog, setDialog] = useState<UserDialogMode | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [otp, setOtp] = useState<{ title: string; otp: OneTimePassword } | null>(null);

  const branchName = useMemo(() => {
    const map = new Map<number, string>();
    for (const branch of branches.data ?? []) map.set(branch.id, branch.name);
    return map;
  }, [branches.data]);

  const refresh = () => {
    users.reload();
    allUsers.reload();
  };

  const guardUsers = allUsers.data ?? users.data ?? [];

  const rows = (users.data ?? []).map((user) => {
    const deactivateReason = user.is_active ? canDeactivate(guardUsers, user, actorId) : null;
    return {
      id: user.id,
      user: (
        <span>
          <span className={styles.primary}>{user.full_name}</span>
          <span className={`${styles.secondary} mono`}>{user.username}</span>
        </span>
      ),
      employee: user.employee ? (
        <span>
          <span className={styles.code}>{user.employee.code}</span>{" "}
          <span>{user.employee.full_name}</span>
        </span>
      ) : null,
      role: <Pill status={ROLE_TONE[user.role]} label={ROLE_LABELS[user.role]} />,
      branches:
        user.branch_ids.length === 0
          ? "All"
          : user.branch_ids.map((id) => branchName.get(id) ?? `#${id}`).join(", "),
      last_login:
        user.last_login_at && user.last_login_at_bs ? (
          <span className={styles.when} title={adDateTime(user.last_login_at)}>
            {bsDateTime(user.last_login_at_bs, user.last_login_at)}
          </span>
        ) : (
          <span className="muted">Never</span>
        ),
      status: <Pill status={user.is_active ? "active" : "inactive"} />,
      actions: (
        <span className={styles.rowActions}>
          <button
            type="button"
            className={styles.ghost}
            onClick={() => setDialog({ kind: "edit", user })}
            aria-label={`Edit ${user.full_name}`}
          >
            Edit
          </button>
          <button
            type="button"
            className={styles.ghost}
            onClick={() => setPending({ kind: "reset", user })}
            aria-label={`Reset password for ${user.full_name}`}
          >
            Reset password
          </button>
          {user.is_active ? (
            <button
              type="button"
              className={`${styles.ghost} ${styles.ghostDanger}`}
              onClick={() => setPending({ kind: "deactivate", user })}
              disabled={Boolean(deactivateReason)}
              title={deactivateReason ?? undefined}
              aria-label={`Deactivate ${user.full_name}`}
            >
              Deactivate
            </button>
          ) : (
            <button
              type="button"
              className={styles.ghost}
              onClick={() => setPending({ kind: "activate", user })}
              aria-label={`Activate ${user.full_name}`}
            >
              Activate
            </button>
          )}
        </span>
      ),
    };
  });

  const runPending = async () => {
    if (!pending) return;
    if (pending.kind === "reset") {
      const result = await resetPassword(pending.user.id);
      setPending(null);
      setOtp({ title: `Password reset for ${pending.user.full_name}`, otp: result });
      show(`Password reset for ${pending.user.username}.`);
    } else {
      const active = pending.kind === "activate";
      await setUserActive(pending.user.id, active);
      setPending(null);
      show(`${pending.user.full_name} ${active ? "activated" : "deactivated"}.`);
    }
    refresh();
  };

  const total = users.data?.length ?? 0;

  return (
    <div className={styles.stack}>
      <PageHeader
        title="Users & roles"
        subtitle="Who can sign in, and what each role can open."
        actions={
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => setDialog({ kind: "create" })}
          >
            <Icon name="users" size={18} />
            Add user
          </button>
        }
      />

      <section aria-label="Users">
        <form
          className={`card ${styles.filters}`}
          role="search"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className={`${styles.filterField} ${styles.search}`}>
            <label htmlFor="users-q" className={styles.filterLabel}>
              Search
            </label>
            <input
              id="users-q"
              className="input"
              type="search"
              placeholder="Name or username"
              value={q}
              onChange={(event) => setQ(event.target.value)}
            />
          </div>
          <div className={`${styles.filterField} ${styles.narrow}`}>
            <label htmlFor="users-role" className={styles.filterLabel}>
              Role
            </label>
            <Select
              id="users-role"
              value={role}
              onChange={(event) => setRole(event.target.value as Role | "")}
            >
              <option value="">All roles</option>
              {ROLES.map((value) => (
                <option key={value} value={value}>
                  {ROLE_LABELS[value]}
                </option>
              ))}
            </Select>
          </div>
          <div className={`${styles.filterField} ${styles.narrow}`}>
            <label htmlFor="users-status" className={styles.filterLabel}>
              Status
            </label>
            <Select
              id="users-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as UserStatusFilter)}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All</option>
            </Select>
          </div>
        </form>

        <p className={styles.summary} role="status">
          {users.loading
            ? "Loading users…"
            : `${total} user${total === 1 ? "" : "s"}${q ? ` matching "${q}"` : ""}`}
        </p>

        {users.error ? (
          <EmptyState icon="alert" title="Could not load users" text={errorMessage(users.error)}>
            <button type="button" className="btn" onClick={users.reload}>
              Try again
            </button>
          </EmptyState>
        ) : (
          <DataTable
            columns={COLUMNS}
            rows={rows}
            compact
            caption="Users"
            emptyText={users.loading ? "Loading…" : "No users match these filters."}
          />
        )}
      </section>

      <RolesMatrix />

      <UserDialog
        mode={dialog}
        users={guardUsers}
        employees={employees.data ?? []}
        branches={branches.data ?? []}
        actorId={actorId}
        onClose={() => setDialog(null)}
        onCreated={(result) => {
          setDialog(null);
          setOtp({ title: `User ${result.user.username} created`, otp: result.one_time_password });
          show(`${result.user.full_name} added.`);
          refresh();
        }}
        onUpdated={(user) => {
          setDialog(null);
          show(`${user.full_name} updated.`);
          refresh();
        }}
      />

      <ConfirmDialog
        open={pending?.kind === "reset"}
        title="Reset password?"
        confirmLabel="Reset password"
        onConfirm={runPending}
        onClose={() => setPending(null)}
      >
        <p>
          <strong>{pending?.user.full_name}</strong> will get a new one-time password and their
          current password stops working immediately.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === "deactivate"}
        title="Deactivate user?"
        confirmLabel="Deactivate"
        danger
        onConfirm={runPending}
        onClose={() => setPending(null)}
      >
        <p>
          <strong>{pending?.user.full_name}</strong> ({pending?.user.username}) will no longer be
          able to sign in. Their history stays; you can activate them again later.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={pending?.kind === "activate"}
        title="Activate user?"
        confirmLabel="Activate"
        onConfirm={runPending}
        onClose={() => setPending(null)}
      >
        <p>
          <strong>{pending?.user.full_name}</strong> will be able to sign in again with their
          existing password. Use Reset password if they have forgotten it.
        </p>
      </ConfirmDialog>

      <Modal open={otp !== null} title={otp?.title ?? ""} onClose={() => setOtp(null)} size="sm">
        {otp ? (
          <div className={styles.form}>
            <OneTimePasswordBox otp={otp.otp} />
            <div className={styles.dialogActions}>
              <button type="button" className="btn btn--primary" onClick={() => setOtp(null)}>
                Done
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Toast toast={toast} onDismiss={dismiss} />
    </div>
  );
}
