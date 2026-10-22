"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Modal } from "@/components/ui/Modal";
import type { Role } from "@/lib/api";
import { Avatar } from "./Avatar";
import { CameraCapture } from "./CameraCapture";
import { Field, SelectInput, TextInput, parseAmount, splitError } from "./FormBits";
import { ReviewCrop } from "./ReviewCrop";
import {
  createBranch,
  createDepartment,
  createEmployee,
  listBranches,
  listDepartments,
  nextEmployeeCode,
} from "./api";
import { dailyExample, monthlyExample } from "./calc";
import { formatRs, suggestUsername } from "./helpers";
import { PayrollIcon } from "./icons";
import { cameraAvailable, fileToDataUrl, shrinkImage } from "./image";
import type { EmployeeProfile, PaidBy, PayType } from "./types";
import { usePayroll } from "./usePayroll";
import photo from "./photo.module.css";
import styles from "./payroll.module.css";

export interface AddEmployeeDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (employee: EmployeeProfile) => void;
}

const ACCESS: { role: Role; label: string }[] = [
  { role: "staff", label: "Staff · own attendance and payslips" },
  { role: "store_keeper", label: "Store keeper · stock entry" },
  { role: "manager", label: "Manager · attendance and reports" },
  { role: "admin", label: "Admin · everything" },
];

const NEW = "__new__";

export const PAY_RULES: Record<PayType, { title: string; hint: string; amountLabel: string; rule: string; exampleLabel: string }> = {
  monthly: {
    title: "Monthly salary",
    hint: "Fixed amount, absences deducted",
    amountLabel: "Salary per month",
    rule: "Pay = monthly salary − (salary ÷ days in month × unpaid days). Leave and Saturdays are paid; a half day deducts ½ day; absent days are unpaid.",
    exampleLabel: "Example, 30-day month with 2 absent days:",
  },
  daily: {
    title: "Daily wage",
    hint: "Paid per day present",
    amountLabel: "Wage per day",
    rule: "Pay = wage × days present. A half day counts as ½; leave and absent days are unpaid.",
    exampleLabel: "Example, 26 days present this month:",
  },
};

export function payExample(payType: PayType, amount: number): number {
  return payType === "monthly" ? monthlyExample(amount) : dailyExample(amount);
}

type PhotoMode = null | "camera" | "review";

export function AddEmployeeDialog({ open, onClose, onCreated }: AddEmployeeDialogProps) {
  const uid = useId();
  const branches = usePayroll(listBranches, []);
  const departments = usePayroll(listDepartments, []);
  const code = usePayroll(nextEmployeeCode, []);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [branchId, setBranchId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [designation, setDesignation] = useState("");
  const [payType, setPayType] = useState<PayType>("monthly");
  const [amount, setAmount] = useState("22000");
  const [paidBy, setPaidBy] = useState<PaidBy>("cash");
  const [login, setLogin] = useState(false);
  const [username, setUsername] = useState("");
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [role, setRole] = useState<Role>("staff");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoMode, setPhotoMode] = useState<PhotoMode>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [newBranch, setNewBranch] = useState<string | null>(null);
  const [newDepartment, setNewDepartment] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ employee: EmployeeProfile; password: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  // Fresh form each time the popup opens.
  useEffect(() => {
    if (!open) return;
    setFullName("");
    setPhone("");
    setBranchId("");
    setDepartmentId("");
    setDesignation("");
    setPayType("monthly");
    setAmount("22000");
    setPaidBy("cash");
    setLogin(false);
    setUsername("");
    setUsernameTouched(false);
    setRole("staff");
    setPhotoUrl(null);
    setPhotoMode(null);
    setShot(null);
    setNewBranch(null);
    setNewDepartment(null);
    setErrors({});
    setFormError(null);
    setSaving(false);
    setResult(null);
    code.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!usernameTouched) setUsername(suggestUsername(fullName));
  }, [fullName, usernameTouched]);

  const amountNumber = parseAmount(amount);
  const rules = PAY_RULES[payType];
  const example = Number.isFinite(amountNumber) ? payExample(payType, amountNumber) : 0;

  const clearError = (field: string) =>
    setErrors((e) => {
      if (!(field in e)) return e;
      const next = { ...e };
      delete next[field];
      return next;
    });

  const onBranchChange = (value: string) => {
    if (value === NEW) {
      setNewBranch("");
      return;
    }
    setBranchId(value);
    clearError("branch_id");
  };
  const onDepartmentChange = (value: string) => {
    if (value === NEW) {
      setNewDepartment("");
      return;
    }
    setDepartmentId(value);
    clearError("department_id");
  };

  const addBranch = async () => {
    try {
      const branch = await createBranch(newBranch ?? "");
      setBranchId(String(branch.id));
      setNewBranch(null);
      clearError("branch_id");
    } catch (err) {
      setErrors((e) => ({ ...e, branch_id: splitError(err).message }));
    }
  };
  const addDepartment = async () => {
    try {
      const department = await createDepartment(newDepartment ?? "");
      setDepartmentId(String(department.id));
      setNewDepartment(null);
      clearError("department_id");
    } catch (err) {
      setErrors((e) => ({ ...e, department_id: splitError(err).message }));
    }
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      setShot(await shrinkImage(await fileToDataUrl(file)));
      setPhotoMode("review");
    } catch (err) {
      setFormError(splitError(err).message);
    }
  };

  const takePhoto = () => {
    if (cameraAvailable()) setPhotoMode("camera");
    else cameraInput.current?.click();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    setErrors({});
    try {
      const created = await createEmployee({
        full_name: fullName,
        phone,
        branch_id: Number(branchId),
        department_id: Number(departmentId),
        designation,
        pay_type: payType,
        amount: amountNumber,
        paid_by: paidBy,
        photo_data_url: photoUrl,
        login: login ? { username, role } : null,
      });
      if (created.one_time_password) {
        setResult({ employee: created.employee, password: created.one_time_password });
      } else {
        onCreated(created.employee);
      }
    } catch (err) {
      const { field, message } = splitError(err);
      if (field) setErrors({ [field]: message });
      else setFormError(message);
    } finally {
      setSaving(false);
    }
  };

  const id = (name: string) => `${uid}-${name}`;
  const title = result ? "Employee added" : "Add employee";

  return (
    <Modal open={open} title={title} onClose={onClose} size="md">
      {result ? (
        <div className={styles.form}>
          <p className={styles.formOk}>
            {result.employee.full_name} ({result.employee.code}) was added with the login{" "}
            <strong>{result.employee.login?.username}</strong>.
          </p>
          <div className={`card ${styles.cardPad}`}>
            <span className={styles.note}>One-time password</span>
            <div className="mono" style={{ fontSize: 24, fontWeight: 600, letterSpacing: "0.08em" }}>
              {result.password}
            </div>
            <p className={styles.note} style={{ marginTop: 6 }}>
              Share it with {result.employee.full_name.split(" ")[0]}; they set their own password on
              first sign-in. It is not shown again.
            </p>
          </div>
          <div className={styles.footerButtons}>
            <button type="button" className="btn btn--primary" onClick={() => onCreated(result.employee)}>
              Open employee
            </button>
          </div>
        </div>
      ) : photoMode === "camera" ? (
        <div className={`${photo.flow} ${photo.compact}`}>
          <CameraCapture
            onCaptured={(dataUrl) => {
              setShot(dataUrl);
              setPhotoMode("review");
            }}
            onCancel={() => setPhotoMode(null)}
          />
        </div>
      ) : photoMode === "review" && shot ? (
        <div className={`${photo.flow} ${photo.compact}`}>
          <ReviewCrop
            src={shot}
            onUse={(dataUrl) => {
              setPhotoUrl(dataUrl);
              setPhotoMode(null);
            }}
            onRetake={() => setPhotoMode(null)}
            retakeLabel="Back"
          />
        </div>
      ) : (
        <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
          <p className={styles.note} style={{ marginTop: -8 }}>
            Employee ID <span className="mono">{code.data ?? "…"}</span> is assigned automatically
          </p>

          <div className={styles.row} style={{ gap: 16 }}>
            {photoUrl || fullName.trim() ? (
              <Avatar name={fullName.trim() || "New employee"} photoUrl={photoUrl} size={72} tone="profile" />
            ) : (
              <span className={styles.photoEmpty} role="img" aria-label="No photo yet" />
            )}
            <div className={styles.row} style={{ gap: 8, flex: "1 1 200px" }}>
              <button type="button" className="btn btn--sm" onClick={takePhoto}>
                <PayrollIcon name="camera" size={16} />
                Take photo
              </button>
              <button type="button" className="btn btn--sm" onClick={() => fileInput.current?.click()}>
                <PayrollIcon name="upload" size={16} />
                Upload
              </button>
              {photoUrl ? (
                <button type="button" className="btn btn--ghost" onClick={() => setPhotoUrl(null)}>
                  Remove
                </button>
              ) : null}
              <span className={styles.note} style={{ width: "100%" }}>
                Optional. You can add it later from a phone.
              </span>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className={photo.fileInput}
              tabIndex={-1}
              aria-label="Upload a photo"
              onChange={(event) => void onFile(event)}
            />
            <input
              ref={cameraInput}
              type="file"
              accept="image/*"
              capture="user"
              className={photo.fileInput}
              tabIndex={-1}
              aria-label="Take a photo with the camera app"
              onChange={(event) => void onFile(event)}
            />
          </div>

          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Personal</legend>
            <Field id={id("name")} label="Full name" error={errors.full_name} span2>
              <TextInput
                id={id("name")}
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  clearError("full_name");
                }}
                placeholder="e.g. Sarita Basnet"
                autoComplete="off"
                invalid={Boolean(errors.full_name)}
                required
              />
            </Field>
            <Field id={id("phone")} label="Phone" error={errors.phone} span2>
              <TextInput
                id={id("phone")}
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  clearError("phone");
                }}
                inputMode="tel"
                placeholder="98XXXXXXXX"
                autoComplete="off"
                invalid={Boolean(errors.phone)}
                required
              />
            </Field>
          </fieldset>

          <fieldset className={`${styles.fieldset} ${styles.fieldset3}`}>
            <legend className={styles.legend}>Work</legend>
            <Field id={id("branch")} label="Branch" error={errors.branch_id}>
              <SelectInput
                id={id("branch")}
                value={newBranch !== null ? NEW : branchId}
                onChange={(e) => onBranchChange(e.target.value)}
                invalid={Boolean(errors.branch_id)}
              >
                <option value="">Choose branch…</option>
                {(branches.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
                <option value={NEW}>+ Add new branch…</option>
              </SelectInput>
            </Field>
            <Field id={id("dept")} label="Department" error={errors.department_id}>
              <SelectInput
                id={id("dept")}
                value={newDepartment !== null ? NEW : departmentId}
                onChange={(e) => onDepartmentChange(e.target.value)}
                invalid={Boolean(errors.department_id)}
              >
                <option value="">Choose department…</option>
                {(departments.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
                <option value={NEW}>+ Add new department…</option>
              </SelectInput>
            </Field>
            <Field id={id("desig")} label="Designation" error={errors.designation}>
              <TextInput
                id={id("desig")}
                value={designation}
                onChange={(e) => {
                  setDesignation(e.target.value);
                  clearError("designation");
                }}
                placeholder="e.g. Cashier"
                autoComplete="off"
                invalid={Boolean(errors.designation)}
                required
              />
            </Field>
            {newBranch !== null ? (
              <div className={styles.inlineAdd}>
                <label htmlFor={id("newbranch")} className={styles.srOnly}>
                  New branch name
                </label>
                <div className="field" style={{ flex: "1 1 auto" }}>
                  <input
                    id={id("newbranch")}
                    value={newBranch}
                    onChange={(e) => setNewBranch(e.target.value)}
                    placeholder="New branch name"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addBranch();
                      }
                    }}
                  />
                </div>
                <button type="button" className="btn" onClick={() => void addBranch()}>
                  Add branch
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setNewBranch(null)}>
                  Cancel
                </button>
              </div>
            ) : null}
            {newDepartment !== null ? (
              <div className={styles.inlineAdd}>
                <label htmlFor={id("newdept")} className={styles.srOnly}>
                  New department name
                </label>
                <div className="field" style={{ flex: "1 1 auto" }}>
                  <input
                    id={id("newdept")}
                    value={newDepartment}
                    onChange={(e) => setNewDepartment(e.target.value)}
                    placeholder="New department name"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addDepartment();
                      }
                    }}
                  />
                </div>
                <button type="button" className="btn" onClick={() => void addDepartment()}>
                  Add department
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setNewDepartment(null)}>
                  Cancel
                </button>
              </div>
            ) : null}
          </fieldset>

          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Salary</legend>
            <div role="group" aria-label="Pay type" className={`${styles.payTypeGroup} ${styles.span2}`}>
              {(["monthly", "daily"] as PayType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={styles.payTypeOption}
                  aria-pressed={payType === type}
                  onClick={() => {
                    setPayType(type);
                    setAmount(type === "monthly" ? "22000" : "800");
                  }}
                >
                  <span className={styles.payTypeTitle}>{PAY_RULES[type].title}</span>
                  <span className={styles.payTypeHint}>{PAY_RULES[type].hint}</span>
                </button>
              ))}
            </div>
            <Field id={id("amount")} label={rules.amountLabel} error={errors.amount}>
              <TextInput
                id={id("amount")}
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  clearError("amount");
                }}
                inputMode="numeric"
                prefix="Rs"
                mono
                invalid={Boolean(errors.amount)}
                required
              />
            </Field>
            <Field id={id("paidby")} label="Paid by">
              <SelectInput id={id("paidby")} value={paidBy} onChange={(e) => setPaidBy(e.target.value as PaidBy)}>
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
              </SelectInput>
            </Field>
            <div className={`${styles.ruleBox} ${styles.span2}`} aria-live="polite">
              <span>{rules.rule}</span>
              <span>
                {rules.exampleLabel} <strong className={styles.ruleExample}>{formatRs(example)}</strong>
              </span>
            </div>
          </fieldset>

          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>App login</legend>
            <label className={`${styles.checkLabel} ${styles.span2}`}>
              <input type="checkbox" checked={login} onChange={(e) => setLogin(e.target.checked)} />
              Let this employee sign in
            </label>
            {login ? (
              <>
                <Field id={id("user")} label="Username" error={errors.username}>
                  <TextInput
                    id={id("user")}
                    value={username}
                    onChange={(e) => {
                      setUsernameTouched(true);
                      setUsername(e.target.value);
                      clearError("username");
                    }}
                    placeholder="e.g. sarita.b"
                    autoComplete="off"
                    autoCapitalize="none"
                    invalid={Boolean(errors.username)}
                  />
                </Field>
                <Field id={id("role")} label="Access">
                  <SelectInput id={id("role")} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                    {ACCESS.map((a) => (
                      <option key={a.role} value={a.role}>
                        {a.label}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                <span className={`${styles.note} ${styles.span2}`}>
                  A one-time password is shown after saving; they set their own on first sign-in.
                </span>
              </>
            ) : null}
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
              {saving ? "Saving…" : "Save employee"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
