"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { BsDateInput } from "@/components/ui/BsDateInput";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, parseAmount, splitError } from "./FormBits";
import { currentMonth, giveAdvance } from "./api";
import { monthsToClear } from "./calc";
import { TODAY, addMonths, monthName } from "./calendar";
import { formatRs } from "./helpers";
import type { Advance, EmployeeProfile } from "./types";
import styles from "./payroll.module.css";

export interface GiveAdvanceDialogProps {
  open: boolean;
  employee: EmployeeProfile;
  onClose: () => void;
  onSaved: (advance: Advance) => void;
}

export function GiveAdvanceDialog({ open, employee, onClose, onSaved }: GiveAdvanceDialogProps) {
  const uid = useId();
  const [amount, setAmount] = useState("5000");
  const [date, setDate] = useState(TODAY.bs);
  const [recovery, setRecovery] = useState("2500");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount("5000");
    setDate(TODAY.bs);
    setRecovery("2500");
    setNote("");
    setErrors({});
    setFormError(null);
  }, [open]);

  const amountNumber = parseAmount(amount);
  const recoveryNumber = parseAmount(recovery);
  const months = monthsToClear(amountNumber, recoveryNumber);
  const clearsBy =
    Number.isFinite(months) && months > 0 ? monthName(addMonths(currentMonth(), months - 1)) : null;
  // (Starts with the next unpaid payslip; shown as "from <month>" at the latest.)
  const id = (name: string) => `${uid}-${name}`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError(null);
    try {
      const advance = await giveAdvance(employee.id, {
        amount: amountNumber,
        given_on_bs: date,
        monthly_recovery: recoveryNumber,
        note,
      });
      onSaved(advance);
    } catch (err) {
      const { field, message } = splitError(err);
      if (field) setErrors({ [field]: message });
      else setFormError(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} title={`Give advance · ${employee.full_name}`} onClose={onClose} size="sm">
      <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Advance</legend>
          <Field id={id("amount")} label="Amount" error={errors.amount} span2>
            <TextInput id={id("amount")} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" prefix="Rs" mono invalid={Boolean(errors.amount)} required />
          </Field>
          <div className={styles.span2}>
            <BsDateInput name="given_on" label="Date given (BS)" value={date} onChange={setDate} required />
            {errors.given_on_bs ? (
              <span className={styles.fieldError} role="alert">
                {errors.given_on_bs}
              </span>
            ) : null}
          </div>
          <Field id={id("recovery")} label="Recover per month" error={errors.monthly_recovery} span2>
            <TextInput id={id("recovery")} value={recovery} onChange={(e) => setRecovery(e.target.value)} inputMode="numeric" prefix="Rs" mono invalid={Boolean(errors.monthly_recovery)} required />
          </Field>
          <Field id={id("note")} label="Note (optional)" span2>
            <TextInput id={id("note")} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Festival advance" />
          </Field>
        </fieldset>
        <div className={styles.ruleBox} aria-live="polite">
          <span>
            Deducted from each payslip until cleared, never more than the net pay of that month.
          </span>
          {Number.isFinite(amountNumber) && Number.isFinite(recoveryNumber) && recoveryNumber > 0 && amountNumber > 0 ? (
            <span>
              {formatRs(recoveryNumber)} × {months} {months === 1 ? "month" : "months"}
              {clearsBy ? ` · clears with the ${clearsBy} salary` : ""}
            </span>
          ) : null}
        </div>
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
            {saving ? "Saving…" : "Record advance"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
