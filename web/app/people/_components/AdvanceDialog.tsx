"use client";

import { useEffect, useId, useState } from "react";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/ui/Modal";
import { Avatar } from "./Avatar";
import { Field, TextInput, parseAmount, splitError } from "./FormBits";
import { PaidByPicker, modesFor } from "./PaidByPicker";
import { getAccountSummary, listPaymentModes, receiptUrl, recordPayment } from "../api";
import { formatBsDay, formatBsShort } from "@/lib/bs";
import { monthLabel, monthName, today } from "../_lib/months";
import { ADVANCE_QUICK, formatAmount, formatRs } from "../_lib/helpers";
import type { Employee, PaymentResult } from "../types";
import { payrollErrorMessage, usePayroll } from "../_lib/usePayroll";
import styles from "./payroll.module.css";
import own from "./employees.module.css";

export interface AdvanceDialogProps {
  open: boolean;
  employee: Employee;
  manageModes?: boolean;
  onClose: () => void;
  /** "Open full ledger ›" */
  onOpenLedger: () => void;
}

/**
 * Give advance (design Employees.dc.html): an advance is part of the running
 * month's salary, so it is capped at what has been earned so far minus what
 * was already paid. Left: amount, quick chips, paid by, date, note. Right:
 * recent payments and totals. Saving shows the receipt in place.
 */
export function AdvanceDialog({ open, employee, manageModes = false, onClose, onOpenLedger }: AdvanceDialogProps) {
  const uid = useId();
  const summary = usePayroll(() => getAccountSummary(employee.id), [employee.id]);
  const modes = usePayroll(() => listPaymentModes(), []);
  const [amount, setAmount] = useState("");
  const [modeId, setModeId] = useState<number | null>(null);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PaymentResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setAmount("");
    setModeId(null);
    setReference("");
    setNote("");
    setSaving(false);
    setError(null);
    setDone(null);
  }, [open]);

  const s = summary.data;
  const room = s?.room ?? 0;
  const amountNumber = parseAmount(amount);
  const typed = amount.trim() !== "";
  const valid = Number.isInteger(amountNumber) && amountNumber > 0;
  const over = valid && amountNumber > room;
  const allowed = modesFor(modes.data ?? [], "advance");
  const effectiveMode = allowed.find((m) => m.id === modeId) ?? allowed[0] ?? null;
  const canSave = valid && !over && !saving && Boolean(s) && Boolean(effectiveMode);
  const quick: { value: number; label: string }[] = [
    ...ADVANCE_QUICK.map((v) => ({ value: v, label: formatAmount(v) })),
    ...(room > Math.max(...ADVANCE_QUICK) ? [{ value: room, label: `Max ${formatAmount(room)}` }] : []),
  ];
  const id = (name: string) => `${uid}-${name}`;
  const t = today();

  const save = async () => {
    if (!canSave || !s || !effectiveMode) return;
    setSaving(true);
    setError(null);
    try {
      const result = await recordPayment({
        employee_id: employee.id,
        for_year: s.month.bs_year,
        for_month: s.month.bs_month,
        kind: "advance",
        amount: amountNumber,
        payment_mode_id: effectiveMode.id,
        reference,
        note,
        date_bs: t.bs,
        source: "account",
      });
      setDone(result);
    } catch (err) {
      setError(splitError(err).message);
    } finally {
      setSaving(false);
    }
  };

  const recent = (s?.recent ?? []).slice(0, 6);
  const monthShort = s ? monthName(s.month) : "";

  return (
    <Modal open={open} title="Give advance" onClose={onClose} size="lg">
      <div className={own.advanceGrid}>
        <div className={styles.stack} style={{ gap: 14 }}>
          <div className={styles.row} style={{ gap: 12 }}>
            <Avatar name={employee.full_name} photoUrl={employee.photo_url} size={44} tone="profile" />
            <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{employee.full_name}</span>
              <span className={styles.note}>
                {employee.code} · {employee.department?.name ?? "—"}
              </span>
            </div>
            <span className={styles.pillAdvance} lang="ne">
              पेश्की
            </span>
          </div>

          {done ? (
            <>
              <div className={styles.doneBox} role="status">
                <span className={styles.doneBadge}>
                  <Icon name="check" size={30} />
                </span>
                <strong className={styles.doneTitle}>Advance saved</strong>
                <span className={styles.doneAmount}>{formatRs(done.payment.amount)}</span>
                <span className={styles.note} style={{ fontSize: 13 }}>
                  {done.payment.payment_mode.name} · {formatBsDay(done.payment.date.bs)} · receipt {done.payment.receipt_no}
                </span>
                <span style={{ fontSize: 13, color: "var(--pill-low-fg)" }}>
                  {monthShort} still due: {formatRs(done.due_after)}
                </span>
              </div>
              <div className={styles.toggle}>
                <button type="button" className={styles.cancelBig} onClick={() => window.open(receiptUrl(done.payment.id), "_blank", "noopener")}>
                  Print receipt
                </button>
                <button type="button" className={styles.primaryBig} onClick={onClose}>
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={styles.tiles3} aria-live="polite">
                <div className={styles.tile} data-tone="ok">
                  <span className={styles.tileLabel}>Earned so far · {monthShort}</span>
                  <span className={styles.tileValue}>{s ? formatRs(s.earned_so_far) : "…"}</span>
                </div>
                <div className={styles.tile} data-tone="advance">
                  <span className={styles.tileLabel}>Already paid · {monthShort}</span>
                  <span className={styles.tileValue}>{s ? formatRs(s.paid_this_month) : "…"}</span>
                </div>
                <div className={styles.tile} data-tone="low">
                  <span className={styles.tileLabel}>Can give now</span>
                  <span className={styles.tileValue}>{s ? formatRs(room) : "…"}</span>
                </div>
              </div>
              {summary.error ? <p className={styles.formError}>{payrollErrorMessage(summary.error)}</p> : null}

              <Field id={id("amount")} label="Amount" error={typed && !valid ? "Enter an amount above 0." : null}>
                <div className={`field ${styles.amountBox}${over ? ` ${styles.amountOver}` : ""}`}>
                  <span className={styles.prefix} style={{ fontSize: 15 }}>
                    Rs
                  </span>
                  <input
                    id={id("amount")}
                    inputMode="numeric"
                    aria-label="Advance amount"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
                    placeholder="0"
                    autoComplete="off"
                  />
                </div>
              </Field>
              <div role="group" aria-label="Quick amounts" className={styles.chips}>
                {quick.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    className={styles.chipSmall}
                    data-tone="advance"
                    aria-pressed={amountNumber === q.value}
                    disabled={q.value > room}
                    onClick={() => setAmount(String(q.value))}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
              {over ? (
                <span className={styles.warn}>
                  More than earned so far this month — at most {formatRs(room)} can be given now.
                </span>
              ) : null}

              <div className={styles.fieldset}>
                {effectiveMode ? (
                  <PaidByPicker
                    modes={modes.data ?? []}
                    value={effectiveMode.id}
                    onChange={setModeId}
                    type="advance"
                    manageHref={manageModes ? "/admin/payment-modes" : null}
                    reference={reference}
                    onReference={setReference}
                  />
                ) : (
                  <span />
                )}
                <Field id={id("date")} label="Date (BS)">
                  <TextInput id={id("date")} value={`${t.bs} · ${formatBsDay(t.bs, "ne")}`} readOnly lang="ne" />
                </Field>
              </div>
              <Field id={id("note")} label="Note (optional)">
                <TextInput id={id("note")} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. festival, medical" autoComplete="off" />
              </Field>
              {error ? (
                <p className={styles.formError} role="alert">
                  {error}
                </p>
              ) : null}
              <div className={own.advanceButtons}>
                <button type="button" className={styles.cancelBig} onClick={onClose} disabled={saving}>
                  Cancel
                </button>
                <button type="button" className={styles.primaryBig} data-tone="advance" disabled={!canSave} onClick={() => void save()}>
                  {saving ? "Saving…" : `Give Rs ${formatAmount(valid ? amountNumber : 0)} advance`}
                </button>
              </div>
            </>
          )}
        </div>

        <aside className={own.advanceSide} aria-label="Recent payments">
          <div className={styles.between}>
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>Recent payments</h3>
            <span className={styles.note}>last {recent.length}</span>
          </div>
          <div className={styles.recentList}>
            {recent.length === 0 ? <span className={styles.note}>No payments yet.</span> : null}
            {recent.map((p) => (
              <div key={p.id} className={styles.recentRow} data-new={done?.payment.id === p.id}>
                <span className={styles.recentTag} data-type={p.kind}>
                  {p.kind === "advance" ? "Advance" : "Salary"}
                </span>
                <span className={styles.recentText}>
                  <span className={styles.recentTitle}>
                    {formatBsShort(p.date.bs)} · {monthName(p.month)}
                  </span>
                  <span className={styles.recentSub}>
                    {p.payment_mode.name}
                    {p.reference ? ` · ${p.reference}` : ""}
                    {p.note ? ` · ${p.note}` : ""} · by {p.recorded_by}
                  </span>
                </span>
                <span className={styles.recentAmount}>{formatRs(p.amount)}</span>
              </div>
            ))}
          </div>
          <div className={own.advanceTotals}>
            <div>
              <span className={styles.tileLabel} style={{ color: "var(--color-muted)" }}>
                Advances · last 4 months
              </span>
              <span className={styles.tileValue} style={{ color: "var(--pill-leave-fg)" }}>
                {s ? formatRs(s.advances_recent) : "…"}
              </span>
            </div>
            <div>
              <span className={styles.tileLabel} style={{ color: "var(--color-muted)" }}>
                Balance due (all months)
              </span>
              <span className={styles.tileValue} style={{ color: "var(--pill-danger-fg)" }}>
                {s ? formatRs(s.balance_due) : "…"}
              </span>
            </div>
          </div>
          <button type="button" className="btn" style={{ color: "var(--color-primary)", fontWeight: 600 }} onClick={onOpenLedger}>
            Open full ledger ›
          </button>
          {s ? (
            <span className={styles.note}>
              Advances count toward {monthLabel(s.month)}; nothing is recovered later.
            </span>
          ) : null}
        </aside>
      </div>
    </Modal>
  );
}
