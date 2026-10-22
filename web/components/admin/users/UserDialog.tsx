"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/Modal";
import { ApiError, errorMessage } from "@/lib/api";
import { createUser, updateUser } from "../api";
import { canChangeRole, canDeactivate } from "../guards";
import {
  findDuplicateUsername,
  normalizeUsername,
  suggestUsername,
  validateName,
  validateUsername,
} from "../names";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "../permissions";
import {
  ROLES,
  type AdminUser,
  type Branch,
  type EmployeeRef,
  type Role,
  type UserCreated,
  type UserInput,
} from "../types";
import { Field, inputClass, Select } from "../components/Field";
import { Toggle } from "../components/Toggle";
import { EmployeePicker } from "./EmployeePicker";
import styles from "../components/admin.module.css";

export type UserDialogMode = { kind: "create" } | { kind: "edit"; user: AdminUser };

export interface UserDialogProps {
  mode: UserDialogMode | null;
  users: AdminUser[];
  employees: EmployeeRef[];
  branches: Branch[];
  actorId: number;
  onClose: () => void;
  onCreated: (result: UserCreated) => void;
  onUpdated: (user: AdminUser) => void;
}

interface FormState extends UserInput {
  branchMode: "all" | "some";
}

function emptyForm(): FormState {
  return {
    full_name: "",
    username: "",
    role: "staff",
    employee_id: null,
    branch_ids: [],
    is_active: true,
    branchMode: "all",
  };
}

function formFrom(user: AdminUser): FormState {
  return {
    full_name: user.full_name,
    username: user.username,
    role: user.role,
    employee_id: user.employee?.id ?? null,
    branch_ids: [...user.branch_ids],
    is_active: user.is_active,
    branchMode: user.branch_ids.length ? "some" : "all",
  };
}

type Errors = Partial<Record<"full_name" | "username" | "role" | "branches" | "form", string>>;

export function UserDialog({
  mode,
  users,
  employees,
  branches,
  actorId,
  onClose,
  onCreated,
  onUpdated,
}: UserDialogProps) {
  const open = mode !== null;
  const editing = mode?.kind === "edit" ? mode.user : null;
  const [form, setForm] = useState<FormState>(emptyForm);
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  // Reset whenever the dialog opens for a different target.
  const modeKey = mode ? (mode.kind === "edit" ? `edit:${mode.user.id}` : "create") : "closed";
  useEffect(() => {
    if (!mode) return;
    setForm(mode.kind === "edit" ? formFrom(mode.user) : emptyForm());
    setUsernameTouched(mode.kind === "edit");
    setErrors({});
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeKey]);

  const roleBlock = useMemo(() => {
    if (!editing) return {} as Partial<Record<Role, string>>;
    const map: Partial<Record<Role, string>> = {};
    for (const role of ROLES) {
      const reason = canChangeRole(users, editing, role, actorId);
      if (reason) map[role] = reason;
    }
    return map;
  }, [editing, users, actorId]);

  const deactivateBlock = editing
    ? canDeactivate(users, { ...editing, role: form.role }, actorId)
    : null;

  const activeBranches = branches.filter(
    (b) => b.is_active || form.branch_ids.includes(b.id),
  );

  const update = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));

  const onNameChange = (value: string) => {
    const patch: Partial<FormState> = { full_name: value };
    if (!usernameTouched && !editing) patch.username = suggestUsername(value);
    update(patch);
  };

  const validate = (): Errors => {
    const next: Errors = {};
    const nameError = validateName(form.full_name, "Full name");
    if (nameError) next.full_name = nameError;
    const usernameError = validateUsername(form.username);
    if (usernameError) next.username = usernameError;
    else {
      const clash = findDuplicateUsername(users, form.username, editing?.id ?? null);
      if (clash) next.username = `Already used by ${clash.full_name}.`;
    }
    if (editing && roleBlock[form.role]) next.role = roleBlock[form.role];
    if (form.branchMode === "some" && form.branch_ids.length === 0) {
      next.branches = "Pick at least one branch, or choose All branches.";
    }
    return next;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const input: UserInput = {
      full_name: form.full_name.replace(/\s+/g, " ").trim(),
      username: normalizeUsername(form.username),
      role: form.role,
      employee_id: form.employee_id,
      branch_ids: form.branchMode === "all" ? [] : form.branch_ids,
      is_active: form.is_active,
    };
    setBusy(true);
    try {
      if (editing) {
        onUpdated(await updateUser(editing.id, input));
      } else {
        onCreated(await createUser(input));
      }
    } catch (err) {
      const message = errorMessage(err);
      if (err instanceof ApiError && /username/i.test(message)) {
        setErrors({ username: message });
      } else {
        setErrors({ form: message });
      }
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  return (
    <Modal
      open={open}
      title={editing ? `Edit ${editing.full_name}` : "Add user"}
      onClose={busy ? () => undefined : onClose}
      size="md"
    >
      <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
        <div className={styles.grid2}>
          <Field label="Full name" error={errors.full_name} span>
            {({ id, describedBy, invalid }) => (
              <input
                id={id}
                className={inputClass(invalid)}
                type="text"
                value={form.full_name}
                onChange={(event) => onNameChange(event.target.value)}
                placeholder="e.g. Sarita Basnet"
                autoComplete="off"
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                maxLength={120}
                required
              />
            )}
          </Field>
          <Field
            label="Username"
            error={errors.username}
            hint="Lower-case; letters, numbers, dots, dashes. No spaces."
          >
            {({ id, describedBy, invalid }) => (
              <input
                id={id}
                className={inputClass(invalid, "mono")}
                type="text"
                value={form.username}
                onChange={(event) => {
                  setUsernameTouched(true);
                  update({ username: event.target.value.toLowerCase() });
                }}
                placeholder="e.g. sarita.b"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                maxLength={64}
                required
              />
            )}
          </Field>
          <Field label="Role" error={errors.role} hint={ROLE_DESCRIPTIONS[form.role]}>
            {({ id, describedBy, invalid }) => (
              <Select
                id={id}
                value={form.role}
                invalid={invalid}
                aria-describedby={describedBy}
                onChange={(event) => update({ role: event.target.value as Role })}
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]} · {ROLE_DESCRIPTIONS[role]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className={styles.span2}>
            <EmployeePicker
              employees={employees}
              users={users}
              editingId={editing?.id ?? null}
              value={form.employee_id}
              onChange={(employee_id) => update({ employee_id })}
            />
          </div>
        </div>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Branch access</legend>
          <div className={styles.radioCards} role="group" aria-label="Branch access">
            <button
              type="button"
              className={styles.radioCard}
              aria-pressed={form.branchMode === "all"}
              onClick={() => update({ branchMode: "all" })}
            >
              <strong>All branches</strong>
              <span>Sees every branch, now and later</span>
            </button>
            <button
              type="button"
              className={styles.radioCard}
              aria-pressed={form.branchMode === "some"}
              onClick={() => update({ branchMode: "some" })}
            >
              <strong>Selected branches</strong>
              <span>Only the branches ticked below</span>
            </button>
          </div>
          {form.branchMode === "some" ? (
            <div className={styles.checkList} style={{ marginTop: 8 }}>
              {activeBranches.map((branch) => (
                <label key={branch.id} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={form.branch_ids.includes(branch.id)}
                    onChange={(event) =>
                      update({
                        branch_ids: event.target.checked
                          ? [...form.branch_ids, branch.id]
                          : form.branch_ids.filter((id) => id !== branch.id),
                      })
                    }
                  />
                  {branch.name}
                  {!branch.is_active ? <span className="muted">(deactivated)</span> : null}
                </label>
              ))}
            </div>
          ) : null}
          {errors.branches ? (
            <p className={styles.fieldError} role="alert">
              {errors.branches}
            </p>
          ) : null}
        </fieldset>

        <Toggle
          label={form.is_active ? "Active - can sign in" : "Inactive - cannot sign in"}
          hint={
            deactivateBlock && form.is_active
              ? deactivateBlock
              : "Deactivated users keep their history and disappear from pickers."
          }
          checked={form.is_active}
          disabled={Boolean(deactivateBlock) && form.is_active}
          onChange={(is_active) => update({ is_active })}
        />

        {!editing ? (
          <p className={styles.note}>
            A one-time password is shown after saving; they set their own on first sign-in.
          </p>
        ) : null}

        {errors.form ? (
          <p className={`${styles.note} ${styles.noteDanger}`} role="alert">
            {errors.form}
          </p>
        ) : null}

        <div className={styles.dialogActions}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "Saving…" : editing ? "Save changes" : "Create user"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
