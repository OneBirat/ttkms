"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { BsDateInput } from "@/components/ui/BsDateInput";
import { Modal } from "@/components/ui/Modal";
import { Field, TextInput, parseAmount, splitError } from "./FormBits";
import { PaidByPicker, modesFor } from "./PaidByPicker";
import { currentMonth, getBalance, listMonths, listPaymentModes, recordPayment } from "../api";
import { paymentError } from "../_lib/calc";
import { monthKey, monthLabel, parseMonthKey, sameMonth, today } from "../_lib/calendar";
import { formatAmount, formatRs } from "../_lib/helpers";
import type { BsMonth, Employee, PaymentResult, PaymentType } from "../types";
import { payrollErrorMessage, usePayroll } from "../_lib/usePayroll";
import styles from "./payroll.module.css";

export interface PaymentDialogProps {
  open: boolean;
  employee: Employee;
  /** What opened it: sets the default type and the title. */
  purpose: "salary" | "record";
  /** Month to start on; "Pay <month> salary" passes the suggested month. */
  month: BsMonth;
  /** Preselect the first bank mode when the salary structure says "paid to bank". */
  preferBank?: boolean;
  /** Admins see "Manage payment modes". */
  manageModes?: boolean;
  onClose: () => void;
  onSaved: (result: PaymentResult) => void;
}

type Quick = "full" | "custom";

const TITLES = { salary: "Pay salary", record: "Record payment" } as const;

/**
 * Salary (or advance, when recording against an older month) payment against
 * one month. Save is disabled when the amount is 0 or above the balance due.
 * Advances for the running month have their own dialog (AdvanceDialog).
 */
export function PaymentDialog({ open, employee, purpose, month, preferBank = false, manageModes = false, onClose, onSaved }: PaymentDialogProps) {
  const uid = useId();
  const [type, setType] = useState<PaymentType>("salary");
  const [key, setKey] = useState(monthKey(month));
  const [quick, setQuick] = useState<Quick | null>(null);
  const [amount, setAmount] = useState("");
  const [modeId, setModeId] = useState<number | null>(null);
  const [reference, setReference] = useState("");
  const [dateBs, setDateBs] = useState(today().bs);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh form each time it opens.
  useEffect(() => {
    if (!open) return;
    setType("salary");
    setKey(monthKey(month));
    setQuick(null);
    setAmount("");
    setModeId(null);
    setReference("");
    setDateBs(today().bs);
    setNote("");
    setSaving(false);
    setError(null);
  }, [open, purpose, month]);

  const months = usePayroll(listMonths, []);
  const modes = usePayroll(() => listPaymentModes(), []);
  const selectedMonth = parseMonthKey(key) ?? currentMonth();
  const balance = usePayroll(() => getBalance(employee.id, selectedMonth), [employee.id, key]);
  const due = balance.data?.due ?? 0;
  const amountNumber = parseAmount(amount);
  const typed = amount.trim() !== "";
  const problem = typed ? paymentError(amountNumber, due) : null;
  const allowed = modesFor(modes.data ?? [], type);
  const defaultMode = (preferBank ? allowed.find((m) => m.type === "bank") : null) ?? allowed[0] ?? null;
  const effectiveMode = allowed.find((m) => m.id === modeId) ?? defaultMode;
  const canSave = typed && !problem && !saving && Boolean(balance.data) && Boolean(effectiveMode);
  const id = (name: string) => `${uid}-${name}`;

  const pick = (value: Quick) => {
    setQuick(value);
    setAmount(value === "full" ? String(due) : "");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave || !effectiveMode) return;
    setSaving(true);
    setError(null);
    try {
      const result = await recordPayment({
        employee_id: employee.id,
        bs_year: selectedMonth.bs_year,
        bs_month: selectedMonth.bs_month,
        type,
        amount: amountNumber,
        payment_mode_id: effectiveMode.id,
        reference,
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

  const label = monthLabel(selectedMonth);
  const running = balance.data?.breakdown.in_progress;

  return (
    <Modal open={open} title={purpose === "salary" ? `Pay ${label} salary` : TITLES[purpose]} onClose={onClose} size="sm">
      <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
        <p className={styles.note} style={{ marginTop: -8 }}>
          {employee.full_name} · {employee.code}
        </p>

        {purpose === "record" ? (
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
                <span>{t === "salary" ? "Salary payment" : "Advance"}</span>
                <span className={styles.toggleSub}>{t === "salary" ? "तलब" : "पेश्की"}</span>
              </button>
            ))}
          </div>
        ) : null}

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

        <div className={styles.tiles3} aria-live="polite">
          <div className={styles.tile} data-tone="ok">
            <span className={styles.tileLabel}>{label} net{running ? " so far" : ""}</span>
            <span className={styles.tileValue}>{balance.data ? formatRs(balance.data.net) : "…"}</span>
          </div>
          <div className={styles.tile} data-tone="advance">
            <span className={styles.tileLabel}>Already paid</span>
            <span className={styles.tileValue}>{balance.data ? formatRs(balance.data.paid) : "…"}</span>
          </div>
          <div className={styles.tile} data-tone="low">
            <span className={styles.tileLabel}>Still due</span>
            <span className={styles.tileValue}>{balance.data ? formatRs(balance.data.due) : "…"}</span>
          </div>
        </div>
        {balance.error ? <p className={styles.formError}>{payrollErrorMessage(balance.error)}</p> : null}

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
            required
          />
        </Field>
        <div role="group" aria-label="Quick amounts" className={styles.chips}>
          <button type="button" className={styles.chipSmall} aria-pressed={quick === "full"} disabled={due <= 0} onClick={() => pick("full")}>
            Full due · {formatAmount(due)}
          </button>
          <button type="button" className={styles.chipSmall} aria-pressed={quick === "custom"} onClick={() => pick("custom")}>
            Custom
          </button>
        </div>

        {effectiveMode ? (
          <PaidByPicker
            modes={modes.data ?? []}
            value={effectiveMode.id}
            onChange={setModeId}
            type={type}
            manageHref={manageModes ? "/admin/payment-modes" : null}
            reference={reference}
            onReference={setReference}
          />
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
