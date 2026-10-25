"use client";

import { useEffect, useId, useState } from "react";
import { Icon } from "@/components/icons";
import { formatBsDay } from "@/lib/bs";
import { Field, TextInput, splitError } from "./FormBits";
import { PaidByPicker, modesFor } from "./PaidByPicker";
import { getSalaryDues, listPaymentModes, paySalary, payslipUrl, receiptUrl } from "../api";
import { afterText, allocate, coverState, defaultAmount, dueMonthSub, overMessage, parseTyped, quickAmounts, settledText, splitChips } from "../_lib/settle";
import { formatAmount, formatRs } from "../_lib/helpers";
import type { Employee, PaymentSource, SalaryPaymentResult } from "../types";
import { payrollErrorMessage, usePayroll } from "../_lib/usePayroll";
import styles from "./payroll.module.css";
import own from "./settle.module.css";

export interface SalaryPayFormProps {
  employee: Employee;
  /** Desktop dialog or the phone sheet (tighter, Share receipt). */
  variant?: "desktop" | "phone";
  /** Where the payment comes from (account screens, or the attendance scan flow). */
  source?: PaymentSource;
  manageModes?: boolean;
  onCancel: () => void;
  /** After a payment: the dialog refreshes its side panel / the account. */
  onPaid?: (result: SalaryPaymentResult) => void;
  onDone: () => void;
}

/**
 * Pay salary (design ui-touch/EmployeesPaySalary.dc.html): the salary due oldest month first,
 * ONE amount (pre-filled with everything due for past months), a live "This payment covers"
 * split, Paid by Cash | Other ▾ (+ reference), today's date; then the receipt with the split.
 * POST /api/payroll/salary-payments does the split for real, in one transaction.
 */
export function SalaryPayForm({ employee, variant = "desktop", source = "account", manageModes = false, onCancel, onPaid, onDone }: SalaryPayFormProps) {
  const uid = useId();
  const dues = usePayroll(() => getSalaryDues(employee.id), [employee.id]);
  const modes = usePayroll(() => listPaymentModes(), []);
  const [amount, setAmount] = useState<string | null>(null);
  const [modeId, setModeId] = useState<number | null>(null);
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SalaryPaymentResult | null>(null);

  const d = dues.data;
  // Pre-fill once the dues are known (everything due for past months, else the total).
  useEffect(() => {
    if (d && amount === null) setAmount(String(defaultAmount(d) || ""));
  }, [d, amount]);

  const typed = amount ?? "";
  const n = parseTyped(typed);
  const total = d?.total_due ?? 0;
  const over = Boolean(d) && n > total;
  const covers = d && n > 0 && !over ? allocate(n, d.months) : [];
  const allowed = modesFor(modes.data ?? [], "salary");
  const mode = allowed.find((m) => m.id === modeId) ?? allowed[0] ?? null;
  const otherMode = Boolean(mode && mode.type !== "cash");
  const canSave = Boolean(d) && n > 0 && !over && !saving && Boolean(mode);
  const todayBs = d?.today.bs ?? "";
  const id = (name: string) => `${uid}-${name}`;

  const save = async () => {
    if (!canSave || !mode) return;
    setSaving(true);
    setError(null);
    try {
      const result = await paySalary({
        employee_id: employee.id,
        amount: n,
        payment_mode_id: mode.id,
        reference: otherMode ? reference : null,
        date_bs: todayBs || null,
        source,
      });
      setDone(result);
      onPaid?.(result);
    } catch (err) {
      setError(splitError(err).message);
      dues.reload();
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    const last = done.split[done.split.length - 1];
    return (
      <div className={styles.stack} style={{ gap: 14 }} data-testid="salary-done">
        <div className={styles.doneBox} role="status">
          <span className={styles.doneBadge} data-tone="salary">
            <Icon name="check" size={30} />
          </span>
          <strong className={styles.doneTitle}>Salary paid</strong>
          <span className={styles.doneAmount} data-tone="salary">
            {formatRs(done.amount)}
          </span>
          <span className={styles.note} style={{ fontSize: 13 }}>
            {done.payment_mode.name} · receipt {done.receipt_no}
          </span>
          <span className={own.chips}>
            {splitChips(done).map((c) => (
              <span key={c.text} className={own.chip} data-cleared={c.cleared || undefined}>
                {c.cleared ? <Icon name="check" size={13} /> : null}
                {c.text}
              </span>
            ))}
          </span>
          <span className={own.after} data-clear={done.total_due_after === 0 || undefined}>
            {afterText(done)}
          </span>
        </div>
        <div className={own.doneButtons} data-variant={variant}>
          <button type="button" className={styles.cancelBig} onClick={() => window.open(receiptUrl(done.payments[0].id), "_blank", "noopener")}>
            {variant === "phone" ? "Share receipt" : "Print receipt"}
          </button>
          {last ? (
            <button type="button" className={styles.cancelBig} onClick={() => window.open(payslipUrl(employee.id, last.month), "_blank", "noopener")}>
              Payslip PDF
            </button>
          ) : null}
          <button type="button" className={styles.primaryBig} onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.stack} style={{ gap: 14 }} data-testid="salary-form">
      {dues.error ? <p className={styles.formError}>{payrollErrorMessage(dues.error)}</p> : null}

      <div className={own.dues} role="table" aria-label="Salary due · oldest first">
        <div className={own.duesHead} role="row">
          <span role="columnheader">Salary due · oldest first</span>
          <span role="columnheader">Net pay</span>
          <span role="columnheader">Paid</span>
          <span role="columnheader">Due</span>
        </div>
        {!d ? (
          <div className={own.duesRow} role="row">
            <span role="cell" className={styles.note}>
              Loading…
            </span>
          </div>
        ) : (
          d.months.map((m) => (
            <div key={`${m.month.bs_year}-${m.month.bs_month}`} className={own.duesRow} role="row" data-month={m.label}>
              <span role="cell" className={own.duesMonth}>
                <span className={own.duesLabel}>{m.label}</span>
                <span className={own.duesSub}>{dueMonthSub(m)}</span>
              </span>
              <span role="cell" className={own.num}>
                {formatAmount(m.net)}
              </span>
              <span role="cell" className={own.num}>
                {formatAmount(m.paid)}
              </span>
              <span role="cell" className={own.due} data-cleared={m.due === 0 || undefined}>
                {m.due === 0 ? (
                  <>
                    {m.cleared_on ? <Icon name="check" size={13} /> : null}
                    {settledText(m)}
                  </>
                ) : (
                  formatAmount(m.due)
                )}
              </span>
            </div>
          ))
        )}
        <div className={own.duesFoot} role="row">
          <span role="cell">Total due</span>
          <span role="cell" className={own.num}>
            {d ? formatRs(total) : "…"}
          </span>
        </div>
      </div>

      <Field id={id("amount")} label="Amount">
        <div className={`field ${styles.amountBox}${over ? ` ${styles.amountOver}` : ""}`}>
          <span className={styles.prefix} style={{ fontSize: 15 }}>
            Rs
          </span>
          <input
            id={id("amount")}
            inputMode="numeric"
            aria-label="Salary amount"
            aria-invalid={over || undefined}
            value={typed}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="0"
            autoComplete="off"
          />
        </div>
      </Field>
      {d ? (
        <div role="group" aria-label="Quick amounts" className={styles.chips}>
          {quickAmounts(d).map((q) => (
            <button key={q.label} type="button" className={styles.chipSmall} aria-pressed={n === q.value} onClick={() => setAmount(String(q.value))}>
              {q.label}
            </button>
          ))}
        </div>
      ) : null}
      {over && d ? (
        <span className={styles.warn} role="alert">
          {overMessage(d)}
        </span>
      ) : null}

      {covers.length > 0 ? (
        <div className={own.covers} aria-label="This payment covers">
          <span className={own.coversTitle}>This payment covers</span>
          {covers.map((a) => (
            <div key={a.month.label} className={own.coverRow}>
              <span>{a.month.label}</span>
              <span className={own.num}>{formatRs(a.amount)}</span>
              <span className={own.coverPill} data-full={a.full || undefined}>
                {a.full ? <Icon name="check" size={12} /> : null}
                {coverState(a, todayBs)}
              </span>
            </div>
          ))}
          <span className={styles.note}>Applied to the oldest month first. One receipt, split by month in the ledger.</span>
        </div>
      ) : null}

      <div className={own.payBy} data-variant={variant}>
        {mode ? (
          <PaidByPicker
            modes={modes.data ?? []}
            value={mode.id}
            onChange={setModeId}
            type="salary"
            variant="other"
            noReference
            manageHref={manageModes ? "/admin/payment-modes" : null}
            reference={reference}
            onReference={setReference}
          />
        ) : (
          <span />
        )}
        <Field id={id("date")} label="Date (BS)">
          <TextInput id={id("date")} value={todayBs ? `${formatBsDay(todayBs)} · ${d?.today.ad ?? ""}` : "…"} readOnly />
        </Field>
      </div>
      {otherMode ? (
        <Field id={id("ref")} label="Reference (optional · bank or wallet transaction ID)">
          <TextInput id={id("ref")} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. NIC ref 89110" autoComplete="off" />
        </Field>
      ) : null}

      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}
      <div className={own.buttons}>
        <button type="button" className={styles.cancelBig} onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="button" className={styles.primaryBig} disabled={!canSave} onClick={() => void save()}>
          {saving ? "Saving…" : `Pay ${formatRs(over ? 0 : n)}`}
        </button>
      </div>
    </div>
  );
}
