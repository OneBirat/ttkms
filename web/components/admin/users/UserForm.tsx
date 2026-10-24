"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/ui/Modal";
import { ApiError, errorMessage } from "@/lib/api";
import { Switch } from "../components/Switch";
import { Select } from "../components/Field";
import { formatPhone, normalizePhone, phoneDigits, phoneError } from "../phone";
import {
  changedKeys,
  cleanOverrides,
  effectiveAccess,
  isCustom,
  LOCKED_FOR_ADMIN,
  PERMISSION_GROUPS,
  presetFor,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
} from "../permissions";
import { createUser, updateUser } from "../usersApi";
import {
  ROLES,
  type Access,
  type AdminUser,
  type PermissionKey,
  type Role,
  type UserCreated,
  type UserInput,
  type UserOptions,
} from "../types";
import styles from "../components/admin.module.css";

export type FormTab = "details" | "access";

export type UserFormMode =
  | { kind: "create"; tab?: FormTab }
  | { kind: "edit"; user: AdminUser; tab?: FormTab };

export interface UserFormProps {
  mode: UserFormMode;
  options: UserOptions;
  /** Every user, for the duplicate-phone check before the API says so. */
  users: AdminUser[];
  /** Desktop dialog or the phone's full-screen sheet. */
  layout: "modal" | "sheet";
  onClose: () => void;
  onCreated: (result: UserCreated) => void;
  onUpdated: (user: AdminUser) => void;
}

interface FormState {
  full_name: string;
  phone: string;
  role: Role;
  branch_id: number | null;
  employee_id: number | null;
  /** null = role preset. */
  access: Access | null;
}

function emptyForm(options: UserOptions): FormState {
  return {
    full_name: "",
    phone: "",
    role: "staff",
    branch_id: options.branches[0]?.id ?? null,
    employee_id: null,
    access: null,
  };
}

function formFrom(user: AdminUser): FormState {
  return {
    full_name: user.full_name,
    phone: user.phone ?? "",
    role: user.role,
    branch_id: user.branch?.id ?? null,
    employee_id: user.employee?.id ?? null,
    access: user.custom ? { ...user.access } : null,
  };
}

/**
 * Add / Edit user with the Details and Access tabs
 * (design/final/AdminUsers.dc.html). The Access tab starts from the role
 * preset; any switch can differ per user ("changed"), "Reset to role" clears
 * the overrides. Admins always keep "Manage users".
 */
export function UserForm({
  mode,
  options,
  users,
  layout,
  onClose,
  onCreated,
  onUpdated,
}: UserFormProps) {
  const editing = mode.kind === "edit" ? mode.user : null;
  const [form, setForm] = useState<FormState>(() =>
    editing ? formFrom(editing) : emptyForm(options),
  );
  const [tab, setTab] = useState<FormTab>(mode.tab ?? "details");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phoneApiError, setPhoneApiError] = useState<string | null>(null);
  const titleId = useId();
  const sheetRef = useRef<HTMLElement>(null);

  // The sheet is its own dialog: focus it on open, close on Escape.
  useEffect(() => {
    if (layout !== "sheet") return;
    const opener = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
      opener?.focus();
    };
  }, [layout]);

  const update = (patch: Partial<FormState>) => {
    setPhoneApiError(null);
    setForm((current) => ({ ...current, ...patch }));
  };

  const roleDefault = presetFor(form.role);
  const access = form.access ?? roleDefault;
  const custom = isCustom(form.role, form.access);
  const changed = new Set(changedKeys(form.role, access));

  const toggleAccess = (key: PermissionKey) => {
    if (form.role === "admin" && key === LOCKED_FOR_ADMIN) return;
    const next = { ...effectiveAccess(form.role, access), [key]: !access[key] };
    update({ access: next });
  };

  const pickRole = (role: Role) => {
    update({
      role,
      access: null,
      branch_id:
        role === "admin" ? null : (form.branch_id ?? options.branches[0]?.id ?? null),
    });
  };

  // Employees not linked to anyone else (plus the one already linked here).
  const employees = useMemo(
    () =>
      options.employees.filter(
        (employee) => employee.user_id === null || employee.user_id === editing?.id,
      ),
    [options.employees, editing?.id],
  );

  const pickEmployee = (value: string) => {
    const id = value ? Number(value) : null;
    const employee = employees.find((e) => e.id === id);
    const patch: Partial<FormState> = { employee_id: id };
    if (employee) {
      if (!form.full_name.trim()) patch.full_name = employee.full_name;
      if (!form.phone && employee.phone) {
        const digits = normalizePhone(employee.phone);
        if (!phoneError(digits)) patch.phone = digits;
      }
      if (form.role !== "admin" && options.branches.some((b) => b.id === employee.branch_id)) {
        patch.branch_id = employee.branch_id;
      }
    }
    update(patch);
  };

  // Validation (the API repeats all of it).
  const nameMissing = !form.full_name.trim();
  const phoneMessage = phoneError(form.phone);
  const phoneTaken = users.some(
    (user) => user.phone === form.phone && user.id !== editing?.id && form.phone !== "",
  );
  const phoneProblem =
    phoneApiError ?? (phoneTaken ? "This phone already has a login." : phoneMessage);
  const branchMissing = form.role !== "admin" && form.branch_id === null;
  const formBad = nameMissing || Boolean(phoneProblem) || branchMissing;

  const save = async () => {
    setTouched(true);
    if (formBad) {
      setTab("details");
      return;
    }
    setBusy(true);
    setError(null);
    const payload: UserInput = {
      full_name: form.full_name.replace(/\s+/g, " ").trim(),
      phone: form.phone,
      role: form.role,
      branch_id: form.role === "admin" ? null : form.branch_id,
      employee_id: form.employee_id,
      access: cleanOverrides(form.role, form.access),
    };
    try {
      if (editing) {
        onUpdated(await updateUser(editing.id, payload));
      } else {
        onCreated(await createUser(payload));
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && /phone/i.test(err.detail)) {
        setPhoneApiError(err.detail);
        setTab("details");
      } else {
        setError(errorMessage(err));
      }
      setBusy(false);
    }
  };

  const onSheetKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  const title = editing ? "Edit user" : "Add user";
  const saveLabel = busy ? "Saving…" : editing ? "Save changes" : "Create user";
  const showErrors = touched;

  const tabs = (
    <div role="tablist" aria-label="User form" className={styles.tabs}>
      <button
        type="button"
        role="tab"
        aria-selected={tab === "details"}
        className={styles.tab}
        onClick={() => setTab("details")}
      >
        Details
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === "access"}
        className={styles.tab}
        onClick={() => setTab("access")}
      >
        Access
        {custom ? <span className={styles.customTag}>Custom</span> : null}
      </button>
    </div>
  );

  const details = (
    <div className={styles.form}>
      <div className={styles.field}>
        <label htmlFor={`${titleId}-emp`} className={styles.fieldLabel}>
          Link to employee <span className={styles.fieldHint}>(optional — fills name and phone)</span>
        </label>
        <Select
          id={`${titleId}-emp`}
          value={form.employee_id ?? ""}
          onChange={(event) => pickEmployee(event.target.value)}
        >
          <option value="">Not linked</option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.full_name} ({employee.code}
              {employee.department ? ` · ${employee.department}` : ""})
            </option>
          ))}
        </Select>
      </div>
      <div className={styles.grid2}>
        <div className={styles.field}>
          <label htmlFor={`${titleId}-name`} className={styles.fieldLabel}>
            Full name
          </label>
          <input
            id={`${titleId}-name`}
            className={`input ${showErrors && nameMissing ? styles.inputError : ""}`}
            value={form.full_name}
            placeholder="e.g. Sita Thapa"
            autoComplete="off"
            aria-invalid={showErrors && nameMissing ? true : undefined}
            onChange={(event) => update({ full_name: event.target.value })}
          />
          {showErrors && nameMissing ? (
            <span className={styles.fieldError} role="alert">
              Full name is required.
            </span>
          ) : null}
        </div>
        <div className={styles.field}>
          <label htmlFor={`${titleId}-phone`} className={styles.fieldLabel}>
            Phone (login)
          </label>
          <div className={`field ${showErrors && phoneProblem ? styles.fieldInvalid : ""}`}>
            <span className={styles.prefix}>+977</span>
            <input
              id={`${titleId}-phone`}
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="98XXXXXXXX"
              value={form.phone}
              aria-invalid={showErrors && phoneProblem ? true : undefined}
              aria-describedby={`${titleId}-phone-err`}
              onChange={(event) => update({ phone: phoneDigits(event.target.value) })}
            />
          </div>
          {(showErrors || phoneTaken || phoneApiError) && phoneProblem ? (
            <span id={`${titleId}-phone-err`} className={styles.fieldError} role="alert">
              {phoneProblem}
            </span>
          ) : form.phone ? (
            <span id={`${titleId}-phone-err`} className={styles.fieldHint}>
              Signs in as {formatPhone(form.phone)}
            </span>
          ) : null}
        </div>
      </div>
      <fieldset className={styles.fieldset}>
        <legend className={styles.fieldLabel} style={{ paddingBottom: 8 }}>
          Role
        </legend>
        <div className={styles.roleCards} role="radiogroup" aria-label="Role">
          {ROLES.map((role) => (
            <button
              key={role}
              type="button"
              role="radio"
              aria-checked={form.role === role}
              className={styles.roleCard}
              onClick={() => pickRole(role)}
            >
              <span className={styles.roleCardTitle}>{ROLE_LABELS[role]}</span>
              <span className={styles.roleCardDesc}>{ROLE_DESCRIPTIONS[role]}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <div className={styles.field}>
        <label htmlFor={`${titleId}-branch`} className={styles.fieldLabel}>
          Branch
        </label>
        {form.role === "admin" ? (
          <Select id={`${titleId}-branch`} value="all" disabled>
            <option value="all">All branches</option>
          </Select>
        ) : (
          <Select
            id={`${titleId}-branch`}
            value={form.branch_id ?? ""}
            invalid={showErrors && branchMissing}
            onChange={(event) =>
              update({ branch_id: event.target.value ? Number(event.target.value) : null })
            }
          >
            {form.branch_id === null ? <option value="">Pick a branch</option> : null}
            {options.branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        )}
        {showErrors && branchMissing ? (
          <span className={styles.fieldError} role="alert">
            Pick the branch this user works in.
          </span>
        ) : null}
      </div>
      {!editing ? (
        <p className={styles.formNote}>
          They sign in with their phone number and a password. A temporary password is shown
          once after saving — they must set their own password at first sign-in (at least 8
          characters).
        </p>
      ) : null}
    </div>
  );

  const accessTab = (
    <div className={styles.accessScroll}>
      <div className={styles.accessHead}>
        <span>
          Starts from the <strong>{ROLE_LABELS[form.role]}</strong> defaults. Switch anything on
          or off for this user.
        </span>
        <button
          type="button"
          className={styles.resetBtn}
          aria-disabled={!custom}
          onClick={() => {
            if (custom) update({ access: null });
          }}
        >
          Reset to role
        </button>
      </div>
      {PERMISSION_GROUPS.map((group) => (
        <div key={group.title} className={styles.accessGroup}>
          <div className={styles.accessGroupTitle}>{group.title}</div>
          {group.items.map((item) => {
            const locked = form.role === "admin" && item.key === LOCKED_FOR_ADMIN;
            return (
              <div key={item.key} className={styles.accessRow}>
                <div className={styles.accessText}>
                  <span className={styles.accessLabel}>{item.label}</span>
                  <span className={styles.accessDesc}>{item.description}</span>
                </div>
                {changed.has(item.key) ? <span className={styles.changed}>changed</span> : null}
                <Switch
                  checked={access[item.key]}
                  onChange={() => toggleAccess(item.key)}
                  label={item.label}
                  disabled={locked}
                  title={locked ? "Admins always keep Manage users." : undefined}
                />
              </div>
            );
          })}
        </div>
      ))}
      {form.role === "admin" ? (
        <p className={styles.adminNote}>
          Admins always keep &quot;Manage users&quot; so the system can&apos;t be locked out.
        </p>
      ) : null}
    </div>
  );

  const errorBox = error ? (
    <p className={`${styles.note} ${styles.noteDanger}`} role="alert">
      {error}
    </p>
  ) : null;

  if (layout === "sheet") {
    return (
      <section
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.sheet}
        onKeyDown={onSheetKey}
      >
        <div className={styles.sheetHead}>
          <button type="button" aria-label="Close" className={styles.sheetClose} onClick={onClose}>
            <Icon name="close" size={22} />
          </button>
          <h2 id={titleId} className={styles.sheetTitle}>
            {title}
          </h2>
        </div>
        <div className={styles.sheetBody}>
          {tabs}
          {errorBox}
          {tab === "details" ? details : accessTab}
        </div>
        <div className={styles.sheetFoot}>
          <button
            type="button"
            className={`btn btn--primary ${styles.sheetSave}`}
            aria-disabled={formBad && touched}
            disabled={busy}
            onClick={() => void save()}
          >
            {saveLabel}
          </button>
        </div>
      </section>
    );
  }

  return (
    <Modal open title={title} onClose={onClose} size="sm">
      <div className={styles.form}>
        {tabs}
        {errorBox}
        {tab === "details" ? details : accessTab}
        <div className={styles.formFoot}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            aria-disabled={formBad && touched}
            disabled={busy}
            onClick={() => void save()}
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
