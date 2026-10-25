"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { BSDate } from "@/components/date";
import { Modal } from "@/components/ui/Modal";
import { Field, SelectInput, TextInput, parseAmount, splitError } from "./FormBits";
import { currentMonth, listPaymentModes, reviseSalary } from "../api";
import { defaultOtRate } from "../_lib/calc";
import { isoBs } from "@/lib/bs";
import { formatRs } from "../_lib/helpers";
import type { Employee, PayType, SalaryStructure } from "../types";
import { usePayroll } from "../_lib/usePayroll";
import styles from "./payroll.module.css";

export interface ReviseSalaryDialogProps {
  open: boolean;
  employee: Employee;
  current: SalaryStructure | null;
  onClose: () => void;
  onSaved: (structure: SalaryStructure) => void;
}

/** New salary structure row: basic + allowances = gross, overtime rate, paid by, effective from. */
export function ReviseSalaryDialog({ open, employee, current, onClose, onSaved }: ReviseSalaryDialogProps) {
  const uid = useId();
  const month = currentMonth();
  const [payType, setPayType] = useState<PayType>("monthly");
  const [basic, setBasic] = useState("");
  const [allowances, setAllowances] = useState("0");
  const [otRate, setOtRate] = useState("");
  const [otTouched, setOtTouched] = useState(false);
  const [modeId, setModeId] = useState<number>(1);
  const modes = usePayroll(() => listPaymentModes(), []);
  const [effective, setEffective] = useState(isoBs(month.bs_year, month.bs_month, 1));
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPayType(current?.pay_type ?? "monthly");
    setBasic(current ? String(current.basic) : "");
    setAllowances(current ? String(current.allowances) : "0");
    setOtRate(current ? String(current.ot_rate) : "");
    setOtTouched(Boolean(current));
    setModeId(current?.default_payment_mode_id ?? 1);
    setEffective(isoBs(month.bs_year, month.bs_month, 1));
    setReason("");
    setErrors({});
    setFormError(null);
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, current]);

  const basicNumber = parseAmount(basic);
  const allowanceNumber = payType === "monthly" ? parseAmount(allowances) || 0 : 0;
  const gross = (Number.isFinite(basicNumber) ? basicNumber : 0) + allowanceNumber;
  const suggested = defaultOtRate(payType, gross);

  useEffect(() => {
    if (!otTouched) setOtRate(String(suggested));
  }, [suggested, otTouched]);

  const id = (name: string) => `${uid}-${name}`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    setErrors({});
    try {
      const structure = await reviseSalary(employee.id, {
        pay_type: payType,
        basic: basicNumber,
        allowances: allowanceNumber,
        ot_rate: parseAmount(otRate),
        default_payment_mode_id: modeId,
        effective_from_bs: effective,
        reason,
      });
      onSaved(structure);
    } catch (err) {
      const { field, message } = splitError(err);
      if (field) setErrors({ [field]: message });
      else setFormError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title="Revise salary" onClose={onClose} size="md">
      <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
        <p className={styles.note} style={{ marginTop: -8 }}>
          {employee.full_name} · {employee.code}
          {current ? ` · currently ${formatRs(current.gross)}${current.pay_type === "daily" ? " / day" : " / month"}` : ""}
        </p>

        <div role="group" aria-label="Pay type" className={styles.payTypeGroup}>
          {(["monthly", "daily"] as PayType[]).map((type) => (
            <button
              key={type}
              type="button"
              className={styles.payTypeOption}
              aria-pressed={payType === type}
              onClick={() => {
                setPayType(type);
                setOtTouched(false);
              }}
            >
              <span className={styles.payTypeTitle}>{type === "monthly" ? "Monthly salary" : "Daily wage"}</span>
              <span className={styles.payTypeHint}>{type === "monthly" ? "Absent days deducted" : "Paid per day worked"}</span>
            </button>
          ))}
        </div>

        <div className={styles.fieldset}>
          <Field id={id("basic")} label={payType === "monthly" ? "Basic salary per month" : "Wage per day"} error={errors.basic}>
            <TextInput
              id={id("basic")}
              value={basic}
              onChange={(e) => setBasic(e.target.value)}
              inputMode="numeric"
              prefix="Rs"
              mono
              invalid={Boolean(errors.basic)}
              required
            />
          </Field>
          {payType === "monthly" ? (
            <Field id={id("allow")} label="Allowances per month" error={errors.allowances} hint={`Gross = ${formatRs(gross)}`}>
              <TextInput
                id={id("allow")}
                value={allowances}
                onChange={(e) => setAllowances(e.target.value)}
                inputMode="numeric"
                prefix="Rs"
                mono
                invalid={Boolean(errors.allowances)}
              />
            </Field>
          ) : (
            <Field id={id("paidby")} label="Paid by">
              <SelectInput id={id("paidby")} value={String(modeId)} onChange={(e) => setModeId(Number(e.target.value))}>
                {(modes.data ?? [{ id: 1, name: "Cash", type: "cash", details: null, use_salary: true, use_advance: true, active: true }])
                  .filter((m) => m.use_salary)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.details ? ` · ${m.details}` : ""}
                    </option>
                  ))}
              </SelectInput>
            </Field>
          )}
          <Field
            id={id("ot")}
            label="Overtime rate per hour"
            error={errors.ot_rate}
            hint={`Default ${formatRs(suggested)} = ${payType === "monthly" ? "salary ÷ 30 ÷ 8" : "wage ÷ 8"}`}
          >
            <TextInput
              id={id("ot")}
              value={otRate}
              onChange={(e) => {
                setOtTouched(true);
                setOtRate(e.target.value);
              }}
              inputMode="numeric"
              prefix="Rs"
              mono
              invalid={Boolean(errors.ot_rate)}
              required
            />
          </Field>
          {payType === "monthly" ? (
            <Field id={id("paidby")} label="Paid by">
              <SelectInput id={id("paidby")} value={String(modeId)} onChange={(e) => setModeId(Number(e.target.value))}>
                {(modes.data ?? [{ id: 1, name: "Cash", type: "cash", details: null, use_salary: true, use_advance: true, active: true }])
                  .filter((m) => m.use_salary)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.details ? ` · ${m.details}` : ""}
                    </option>
                  ))}
              </SelectInput>
            </Field>
          ) : null}
          <Field id={id("eff")} label="Effective from" error={errors.effective_from_bs}>
            <BSDate id={id("eff")} name="effective_from_bs" value={effective} onChange={(bs) => setEffective(bs)} invalid={Boolean(errors.effective_from_bs)} block />
          </Field>
          <Field id={id("reason")} label="Reason (optional)">
            <TextInput id={id("reason")} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Annual increment" autoComplete="off" />
          </Field>
        </div>

        <p className={styles.note}>
          Months from the effective date use the new structure; months already paid are not recalculated.
        </p>

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
            {saving ? "Saving…" : "Save structure"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
