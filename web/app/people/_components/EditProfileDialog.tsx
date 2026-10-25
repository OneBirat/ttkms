"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { BSDate } from "@/components/date";
import { Modal } from "@/components/ui/Modal";
import { Field, SelectInput, TextArea, TextInput, splitError } from "./FormBits";
import { NepaliNameField } from "./NepaliNameField";
import { listBranches, listDepartments, updateEmployee, type SalaryStructureOut } from "../api";
import { formatBs } from "@/lib/bs";
import { formatRs } from "../_lib/helpers";
import type { Employee, SalaryStructure } from "../types";
import { usePayroll } from "../_lib/usePayroll";
import styles from "./payroll.module.css";

export interface EditProfileDialogProps {
  open: boolean;
  employee: Employee;
  /** Current salary + history for the "Salary" section (null while loading). */
  salary?: SalaryStructureOut | null;
  /** Opens the Revise salary dialog (in place of this one). */
  onRevise?: () => void;
  onClose: () => void;
  onSaved: (employee: Employee) => void;
}

function amountOf(s: SalaryStructure): string {
  return `${formatRs(s.pay_type === "daily" ? s.basic : s.gross)} / ${s.pay_type === "daily" ? "day" : "month"}`;
}

export function EditProfileDialog({ open, employee, salary = null, onRevise, onClose, onSaved }: EditProfileDialogProps) {
  const uid = useId();
  const branches = usePayroll(listBranches, []);
  const departments = usePayroll(listDepartments, []);
  const [fullName, setFullName] = useState(employee.full_name);
  const [fullNameNp, setFullNameNp] = useState(employee.full_name_np ?? "");
  const [phone, setPhone] = useState(employee.phone ?? "");
  const [phoneAlt, setPhoneAlt] = useState(employee.phone_alt ?? "");
  const [address, setAddress] = useState(employee.address ?? "");
  const [branchId, setBranchId] = useState(String(employee.branch.id));
  const [departmentId, setDepartmentId] = useState(String(employee.department?.id ?? ""));
  const [designation, setDesignation] = useState(employee.designation ?? "");
  const [joined, setJoined] = useState(employee.joined.bs);
  const [active, setActive] = useState(employee.active);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFullName(employee.full_name);
    setFullNameNp(employee.full_name_np ?? "");
    setPhone(employee.phone ?? "");
    setPhoneAlt(employee.phone_alt ?? "");
    setAddress(employee.address ?? "");
    setBranchId(String(employee.branch.id));
    setDepartmentId(String(employee.department?.id ?? ""));
    setDesignation(employee.designation ?? "");
    setJoined(employee.joined.bs);
    setActive(employee.active);
    setErrors({});
    setFormError(null);
    setSaving(false);
  }, [open, employee]);

  const id = (name: string) => `${uid}-${name}`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    setErrors({});
    try {
      const saved = await updateEmployee(employee.id, {
        full_name: fullName,
        full_name_np: fullNameNp,
        phone,
        phone_alt: phoneAlt,
        address,
        branch_id: Number(branchId),
        department_id: Number(departmentId),
        designation,
        active,
        joined_bs: joined,
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
    <Modal open={open} title="Edit profile" onClose={onClose} size="md">
      <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
        <p className={styles.note} style={{ marginTop: -8 }}>
          {employee.code} · barcode <span className="mono">{employee.barcode}</span>
        </p>
        <div className={styles.fieldset}>
          <Field id={id("name")} label="Full name" error={errors.full_name} span2>
            <TextInput id={id("name")} value={fullName} onChange={(e) => setFullName(e.target.value)} invalid={Boolean(errors.full_name)} required />
          </Field>
          <NepaliNameField id={id("namenp")} value={fullNameNp} onChange={setFullNameNp} fullName={fullName} span2 />
          <Field id={id("phone")} label="Phone" error={errors.phone}>
            <TextInput id={id("phone")} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" prefix="+977" invalid={Boolean(errors.phone)} required />
          </Field>
          <Field id={id("alt")} label="Extra contact (optional)">
            <TextInput id={id("alt")} value={phoneAlt} onChange={(e) => setPhoneAlt(e.target.value)} inputMode="tel" placeholder="Family member or second number" />
          </Field>
          <Field id={id("addr")} label="Address" span2>
            <TextArea id={id("addr")} value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />
          </Field>
          <Field id={id("branch")} label="Branch" error={errors.branch_id}>
            <SelectInput id={id("branch")} value={branchId} onChange={(e) => setBranchId(e.target.value)} invalid={Boolean(errors.branch_id)}>
              {(branches.data ?? [employee.branch]).map((b) => (
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
          <Field id={id("joined")} label="Joined" error={errors.joined_bs}>
            <BSDate id={id("joined")} name="joined_bs" value={joined} onChange={(bs) => setJoined(bs)} invalid={Boolean(errors.joined_bs)} noFutureDays block />
          </Field>
          <label className={`${styles.checkLabel} ${styles.span2}`}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active employee (inactive staff keep their history but leave the salary report)
          </label>
        </div>

        {onRevise ? <SalarySection salary={salary} onRevise={onRevise} /> : null}

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

/** "Salary": what is in force, the OT rate, every effective-from step, and Revise. */
function SalarySection({ salary, onRevise }: { salary: SalaryStructureOut | null; onRevise: () => void }) {
  const current = salary?.current ?? null;
  const history = salary?.history ?? [];
  return (
    <section aria-labelledby="edit-salary-h" className={styles.salarySection} data-testid="edit-salary">
      <div className={styles.salaryHead}>
        <h3 id="edit-salary-h" className={styles.salaryTitle}>
          Salary
        </h3>
        <button type="button" className="btn btn--sm" onClick={onRevise}>
          Revise
        </button>
      </div>
      {salary === null ? (
        <p className={styles.note}>Loading…</p>
      ) : current ? (
        <>
          <div className={styles.salaryNow}>
            <span>
              {current.pay_type === "daily" ? "Daily wage" : "Monthly salary"} <b>{amountOf(current)}</b>
            </span>
            <span>
              OT rate <b>{formatRs(current.ot_rate)} / h</b>
            </span>
          </div>
          <ul className={styles.salaryHistory} aria-label="Salary history">
            {history.map((s) => (
              <li key={s.id}>
                <span>From {formatBs(s.effective_from.bs)}</span>
                <span className="mono">{amountOf(s)}</span>
                <span className={styles.note}>{s.reason ?? ""}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className={styles.note}>No salary set up yet.</p>
      )}
    </section>
  );
}
