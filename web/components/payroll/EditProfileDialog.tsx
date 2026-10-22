"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/Modal";
import { Field, SelectInput, TextInput, splitError } from "./FormBits";
import { listBranches, listDepartments, updateEmployee } from "./api";
import type { EmployeeProfile, EmployeeStatus } from "./types";
import { usePayroll } from "./usePayroll";
import styles from "./payroll.module.css";

export interface EditProfileDialogProps {
  open: boolean;
  employee: EmployeeProfile;
  onClose: () => void;
  onSaved: (employee: EmployeeProfile) => void;
}

export function EditProfileDialog({ open, employee, onClose, onSaved }: EditProfileDialogProps) {
  const uid = useId();
  const branches = usePayroll(listBranches, []);
  const departments = usePayroll(listDepartments, []);
  const [fullName, setFullName] = useState(employee.full_name);
  const [phone, setPhone] = useState(employee.phone ?? "");
  const [branchId, setBranchId] = useState(String(employee.branch.id));
  const [departmentId, setDepartmentId] = useState(String(employee.department?.id ?? ""));
  const [designation, setDesignation] = useState(employee.designation ?? "");
  const [status, setStatus] = useState<EmployeeStatus>(employee.status);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFullName(employee.full_name);
    setPhone(employee.phone ?? "");
    setBranchId(String(employee.branch.id));
    setDepartmentId(String(employee.department?.id ?? ""));
    setDesignation(employee.designation ?? "");
    setStatus(employee.status);
    setErrors({});
    setFormError(null);
  }, [open, employee]);

  const id = (name: string) => `${uid}-${name}`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const saved = await updateEmployee(employee.id, {
        full_name: fullName,
        phone,
        branch_id: Number(branchId),
        department_id: Number(departmentId),
        designation,
        status,
      });
      onSaved(saved);
    } catch (err) {
      const { field, message } = splitError(err);
      if (field) setErrors({ [field]: message });
      else setFormError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title={`Edit profile · ${employee.code}`} onClose={onClose} size="md">
      <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Personal</legend>
          <Field id={id("name")} label="Full name" error={errors.full_name} span2>
            <TextInput id={id("name")} value={fullName} onChange={(e) => setFullName(e.target.value)} invalid={Boolean(errors.full_name)} required />
          </Field>
          <Field id={id("phone")} label="Phone" error={errors.phone} span2>
            <TextInput id={id("phone")} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" invalid={Boolean(errors.phone)} required />
          </Field>
        </fieldset>
        <fieldset className={`${styles.fieldset} ${styles.fieldset3}`}>
          <legend className={styles.legend}>Work</legend>
          <Field id={id("branch")} label="Branch" error={errors.branch_id}>
            <SelectInput id={id("branch")} value={branchId} onChange={(e) => setBranchId(e.target.value)} invalid={Boolean(errors.branch_id)}>
              <option value="">Choose branch…</option>
              {(branches.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field id={id("dept")} label="Department" error={errors.department_id}>
            <SelectInput id={id("dept")} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} invalid={Boolean(errors.department_id)}>
              <option value="">Choose department…</option>
              {(departments.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field id={id("desig")} label="Designation" error={errors.designation}>
            <TextInput id={id("desig")} value={designation} onChange={(e) => setDesignation(e.target.value)} invalid={Boolean(errors.designation)} required />
          </Field>
          <Field id={id("status")} label="Status" hint="Inactive staff keep their history but leave the payroll.">
            <SelectInput id={id("status")} value={status} onChange={(e) => setStatus(e.target.value as EmployeeStatus)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </SelectInput>
          </Field>
        </fieldset>
        {formError ? (
          <p className={styles.formError} role="alert">
            {formError}
          </p>
        ) : null}
        <div className={styles.footerButtons}>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
