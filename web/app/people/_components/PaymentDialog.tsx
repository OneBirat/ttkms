"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { BsDateInput } from "@/components/ui/BsDateInput";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, parseAmount, splitError } from "./FormBits";
import { currentMonth, getBalance, listMonths, recordPayment } from "../api";
import { paymentError } from "../_lib/calc";
import { monthKey, monthLabel, parseMonthKey, sameMonth, today } from "../_lib/calendar";
import { ADVANCE_QUICK, formatAmount, formatRs } from "../_lib/helpers";
import type { BsMonth, Employee, PaymentMode, PaymentResult, PaymentType } from "../types";
import { payrollErrorMessage, usePayroll } from "../_lib/usePayroll";
import styles from "./payroll.module.css";

export interface PaymentDialogProps {
  open: boolean;
  employee: Employee;
  /** What opened it: sets the default type and the title. */
  purpose: "salary" | "advance" | "record";
  /** Month to start on; "Pay <month> salary" passes the suggested month. */
  month: BsMonth;
  onClose: () => void;
  onSaved: (result: PaymentResult) => void;
}

type Quick = "full" | "custom" | `${number}`;

const TITLES = { salary: "Pay salary", advance: "Give advance", record: "Record payment" } as const;

/**
 * Salary | Advance payment against one month (design: AttendanceScanPay /
 * AttendanceScanSalary). Save is disabled when the amount is 0 or above the
 * balance due. Also the shape the attendance scan pop-up records through.
 */
export function PaymentDialog({ open, employee, purpose, month, onClose, onSaved }: PaymentDialogProps) {
  const uid = useId();
  const [type, setType] = useState<PaymentType>(purpose === "advance" ? "advance" : "salary");
  const [key, setKey] = useState(monthKey(month));
  const [quick, setQuick] = useState<Quick | null>(null);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PaymentMode>("cash");
  const [reference, setReference] = useState("");
  const [dateBs, setDateBs] = useState(today().bs);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh form each time it opens.
  useEffect(() => {
    if (!open) return;
    setType(purpose === "advance" ? "advance" : "salary");
    setKey(monthKey(month));
    setQuick(null);
    setAmount("");
    setMode("cash");
    setReference("");
    setDateBs(today().bs);
    setNote("");
    setSaving(false);
    setError(null);
  }, [open, purpose, month]);

  const months = usePayroll(listMonths, []);
  const selectedMonth = parseMonthKey(key) ?? currentMonth();
  const balance = usePayroll(() => getBalance(employee.id, selectedMonth), [employee.id, key]);
  const due = balance.data?.due ?? 0;
  const amountNumber = parseAmount(amount);
  const typed = amount.trim() !== "";
  const problem = typed ? paymentError(amountNumber, due) : null;
  const canSave = typed && !problem && !saving && Boolean(balance.data);
  const id = (name: string) => `${uid}-${name}`;

  const pick = (value: Quick) => {
    setQuick(value);
    if (value === "full") setAmount(String(due));
    else if (value === "custom") setAmount("");
    else setAmount(value);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const result = await recordPayment({
        employee_id: employee.id,
        bs_year: selectedMonth.bs_year,
        bs_month: selectedMonth.bs_month,
        type,
        amount: amountNumber,
        mode,
        reference: mode === "bank" ? reference : null,
        note,
        date_bs: dateBs,
        source: "account",
      });
      onSaved(result);
    } catch (err) {
      setError(splitError(err).message);
    } finally {
      setSaving(false);
    }
  };

  const quickOptions: { value: Quick; label: string; wide?: boolean }[] =
    type === "salary"
      ? [
          { value: "full", label: `Full due · Rs ${formatAmount(due)}`, wide: true },
          { value: "custom", label: "Custom amount", wide: true },
        ]
      : [...ADVANCE_QUICK.map((v) => ({ value: `${v}` as Quick, label: `Rs ${formatAmount(v)}` })), { value: "custom", label: "Custom" }];

  const label = selectedMonth ? monthLabel(selectedMonth) : "";
  const running = balance.data?.breakdown.in_progress;

  return (
    <Modal open={open} title={TITLES[purpose]} onClose={onClose} size="sm">
      <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
        <p className={styles.note} style={{ marginTop: -8 }}>
          {employee.full_name} · {employee.code}
        </p>

        <div role="group" aria-label="Payment type" className={styles.toggle}>
          {(["salary", "advance"] as PaymentType[]).map((t) => (
            <button
              key={t}
              type="button"
              className={styles.toggleOption}
              data-tone={t}
              aria-pressed={type === t}
              onClick={() => {
                setType(t);
                setQuick(null);
                setAmount("");
              }}
            >
              <span>{t === "salary" ? "Salary payment" : "Advance payment"}</span>
              <span className={styles.toggleSub}>{t === "salary" ? "तलब भुक्तानी" : "पेश्की भुक्तानी"}</span>
            </button>
          ))}
        </div>

        <Field id={id("month")} label="For month (BS)">
          <div className={`field ${styles.selectWrap}`}>
            <select
              id={id("month")}
              value={key}
              onChange={(event) => {
                setKey(event.target.value);
                setQuick(null);
                setAmount("");
              }}
            >
              {(months.data ?? [month]).map((m) => (
                <option key={monthKey(m)} value={monthKey(m)}>
                  {monthLabel(m)}
                  {sameMonth(m, currentMonth()) ? " · in progress" : ""}
                </option>
              ))}
            </select>
          </div>
        </Field>

        <div className={styles.balance} aria-live="polite">
          <div>
            {label} net{running ? " so far" : ""}
            <span className={styles.balanceValue}>{balance.data ? formatRs(balance.data.net) : "…"}</span>
          </div>
          <div>
            Paid
            <span className={`${styles.balanceValue} ${styles.balancePaid}`}>
              {balance.data ? formatRs(balance.data.paid) : "…"}
            </span>
          </div>
          <div>
            Due
            <span className={`${styles.balanceValue} ${styles.balanceDue}`}>
              {balance.data ? formatRs(balance.data.due) : "…"}
            </span>
          </div>
        </div>
        {balance.error ? <p className={styles.formError}>{payrollErrorMessage(balance.error)}</p> : null}

        <div role="group" aria-label="Amount" className={styles.quick}>
          {quickOptions.map((q) => (
            <button
              key={q.value}
              type="button"
              className={q.wide ? `${styles.quickOption} ${styles.quickWide}` : styles.quickOption}
              data-tone={type}
              aria-pressed={quick === q.value}
              disabled={q.value === "full" && due <= 0}
              onClick={() => pick(q.value)}
            >
              {q.label}
            </button>
          ))}
        </div>

        <Field id={id("amount")} label="Amount" error={problem}>
          <TextInput
            id={id("amount")}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setQuick("custom");
            }}
            inputMode="numeric"
            prefix="Rs"
            mono
            placeholder="Type amount"
            invalid={Boolean(problem)}
            autoFocus={quick === "custom"}
            required
          />
        </Field>

        <div role="group" aria-label="Paid by" className={styles.toggle}>
          {(["cash", "bank"] as PaymentMode[]).map((m) => (
            <button key={m} type="button" className={styles.toggleOption} aria-pressed={mode === m} onClick={() => setMode(m)}>
              {m === "cash" ? "Cash" : "Bank transfer"}
            </button>
          ))}
        </div>
        {mode === "bank" ? (
          <Field id={id("ref")} label="Bank reference">
            <TextInput
              id={id("ref")}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Transfer / cheque number"
              autoComplete="off"
            />
          </Field>
        ) : null}

        <div className={styles.fieldset}>
          <Field id={id("date")} label="Date (BS)">
            <BsDateInput id={id("date")} name="date_bs" value={dateBs} onChange={setDateBs} />
          </Field>
          <Field id={id("note")} label="Note (optional)">
            <TextInput id={id("note")} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Dashain" autoComplete="off" />
          </Field>
        </div>

        {error ? (
          <p className={styles.formError} role="alert">
            {error}
          </p>
        ) : null}

        <div className={styles.footerButtons}>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={!canSave}>
            {saving ? "Saving…" : typed && !problem ? `Save ${type === "salary" ? "salary" : "advance"} · Rs ${formatAmount(amountNumber)}` : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
