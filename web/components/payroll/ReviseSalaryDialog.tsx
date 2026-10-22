"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { BsDateInput } from "@/components/ui/BsDateInput";
import { Modal } from "@/components/ui/Modal";
import { PAY_RULES, payExample } from "./AddEmployeeDialog";
import { Field, SelectInput, TextInput, parseAmount, splitError } from "./FormBits";
import { currentMonth, reviseSalary } from "./api";
import { monthStart } from "./calendar";
import { formatRs } from "./helpers";
import type { EmployeeProfile, PaidBy, PayType, SalaryStructure } from "./types";
import styles from "./payroll.module.css";

export interface ReviseSalaryDialogProps {
  open: boolean;
  employee: EmployeeProfile;
  current: SalaryStructure | null;
  onClose: () => void;
  onSaved: (structure: SalaryStructure) => void;
}

export function ReviseSalaryDialog({ open, employee, current, onClose, onSaved }: ReviseSalaryDialogProps) {
  const uid = useId();
  const [payType, setPayType] = useState<PayType>(current?.pay_type ?? "monthly");
  const [amount, setAmount] = useState(String(current?.amount ?? ""));
  const [paidBy, setPaidBy] = useState<PaidBy>(current?.paid_by ?? "cash");
  const [from, setFrom] = useState(monthStart(currentMonth()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPayType(current?.pay_type ?? "monthly");
    setAmount(String(current?.amount ?? ""));
    setPaidBy(current?.paid_by ?? "cash");
    setFrom(monthStart(currentMonth()));
    setErrors({});
    setFormError(null);
  }, [open, current]);

  const amountNumber = parseAmount(amount);
  const rules = PAY_RULES[payType];
  const id = (name: string) => `${uid}-${name}`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const structure = await reviseSalary(employee.id, {
        pay_type: payType,
        amount: amountNumber,
        paid_by: paidBy,
        effective_from_bs: from,
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
    <Modal open={open} title={`Revise pay · ${employee.full_name}`} onClose={onClose} size="md">
      <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
        {current ? (
          <p className={styles.note} style={{ marginTop: -8 }}>
            Now: {current.pay_type === "monthly" ? "monthly salary" : "daily wage"} {formatRs(current.amount)}
            {current.pay_type === "daily" ? " per day" : ""}, paid by {current.paid_by}, since {current.effective_from.bs}.
          </p>
        ) : null}
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>New structure</legend>
          <div role="group" aria-label="Pay type" className={`${styles.payTypeGroup} ${styles.span2}`}>
            {(["monthly", "daily"] as PayType[]).map((type) => (
              <button key={type} type="button" className={styles.payTypeOption} aria-pressed={payType === type} onClick={() => setPayType(type)}>
                <span className={styles.payTypeTitle}>{PAY_RULES[type].title}</span>
                <span className={styles.payTypeHint}>{PAY_RULES[type].hint}</span>
              </button>
            ))}
          </div>
          <Field id={id("amount")} label={rules.amountLabel} error={errors.amount}>
            <TextInput id={id("amount")} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" prefix="Rs" mono invalid={Boolean(errors.amount)} required />
          </Field>
          <Field id={id("paidby")} label="Paid by">
            <SelectInput id={id("paidby")} value={paidBy} onChange={(e) => setPaidBy(e.target.value as PaidBy)}>
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
            </SelectInput>
          </Field>
          <div className={styles.span2}>
            <BsDateInput name="effective_from" label="Effective from (BS)" value={from} onChange={setFrom} required />
            {errors.effective_from_bs ? (
              <span className={styles.fieldError} role="alert">
                {errors.effective_from_bs}
              </span>
            ) : null}
          </div>
          <div className={`${styles.ruleBox} ${styles.span2}`} aria-live="polite">
            <span>{rules.rule}</span>
            <span>
              {rules.exampleLabel}{" "}
              <strong className={styles.ruleExample}>
                {formatRs(Number.isFinite(amountNumber) ? payExample(payType, amountNumber) : 0)}
              </strong>
            </span>
            <span>Pending payslips are recalculated; paid months do not change.</span>
          </div>
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
            {saving ? "Saving…" : "Save revision"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
