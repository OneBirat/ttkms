"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { BottomSheet } from "./BottomSheet";
import { PaidByPicker, modesFor } from "../PaidByPicker";
import { SalaryPayForm } from "../SalaryPayForm";
import { getAccountSummary, listPaymentModes, receiptUrl, recordPayment } from "../../api";
import { formatBs, formatBsShort } from "@/lib/bs";
import { monthName, today } from "../../_lib/months";
import { ADVANCE_QUICK, formatAmount, formatRs, initials } from "../../_lib/helpers";
import type { Employee, PaymentResult, PaymentType } from "../../types";
import { payrollErrorMessage, usePayroll } from "../../_lib/usePayroll";
import styles from "./phone.module.css";
import shared from "../payroll.module.css";

export interface PaySheetProps {
  open: boolean;
  employee: Employee;
  /** Which tab the sheet opens on. */
  initialType: PaymentType;
  isAdmin: boolean;
  onClose: () => void;
}

/**
 * Give advance / Pay salary bottom sheet (design PayrollMobile). Advances go
 * against the running month (capped at what is earned so far); salary is the
 * shared SalaryPayForm (one amount, oldest month first). Paid by: Cash | Other ▾.
 */
export function PaySheet({ open, employee, initialType, isAdmin, onClose }: PaySheetProps) {
  const summary = usePayroll(() => getAccountSummary(employee.id), [employee.id]);
  const modes = usePayroll(() => listPaymentModes(), []);
  const [type, setType] = useState<PaymentType>(initialType);
  const [amount, setAmount] = useState("");
  const [modeId, setModeId] = useState<number | null>(null);
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PaymentResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setType(initialType);
    setAmount("");
    setModeId(null);
    setReference("");
    setSaving(false);
    setError(null);
    setDone(null);
  }, [open, initialType]);

  const s = summary.data;
  const isSalary = type === "salary";
  // Salary has its own form (SalaryPayForm); what follows is the advance.
  const room = s ? s.room : 0;
  const amountNumber = amount ? Number(amount) : 0;
  const valid = Number.isInteger(amountNumber) && amountNumber > 0;
  const over = valid && amountNumber > room;
  const allowed = modesFor(modes.data ?? [], "advance");
  const effectiveMode = allowed.find((m) => m.id === modeId) ?? allowed[0] ?? null;
  const canSave = valid && !over && !saving && Boolean(s) && Boolean(effectiveMode);
  const month = s ? s.month : null;
  const quick: { value: number; label: string }[] = [...ADVANCE_QUICK.filter((v) => v <= room).map((v) => ({ value: v, label: formatAmount(v) })), ...(room > 0 && !ADVANCE_QUICK.includes(room as 500) ? [{ value: room, label: `Max ${formatAmount(room)}` }] : [])];

  const save = async () => {
    if (!canSave || !s || !effectiveMode || !month) return;
    setSaving(true);
    setError(null);
    try {
      const result = await recordPayment({
        employee_id: employee.id,
        for_year: month.bs_year,
        for_month: month.bs_month,
        kind: "advance",
        amount: amountNumber,
        payment_mode_id: effectiveMode.id,
        reference,
        date_bs: today().bs,
        source: "account",
      });
      setDone(result);
    } catch (err) {
      setError(payrollErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const recent = (s?.recent ?? []).slice(0, 4);
  const typeToggle = (
    <div className={styles.typeToggle} role="group" aria-label="Payment type">
      {(["advance", "salary"] as PaymentType[]).map((k) => (
        <button
          key={k}
          type="button"
          className={styles.typeOption}
          data-type={k}
          aria-pressed={type === k}
          onClick={() => {
            setType(k);
            setAmount("");
            setModeId(null);
          }}
        >
          {k === "advance" ? "Advance" : "Salary"}
        </button>
      ))}
    </div>
  );

  return (
    <BottomSheet open={open} label={isSalary ? "Pay salary" : "Give advance"} onClose={onClose}>
      <div className={styles.sheetHeader}>
        <span className={styles.avatarTone} style={{ background: "#cfe3e0", color: "#0a5454" }}>
          {initials(employee.full_name)}
        </span>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          <h2 className={styles.sheetTitle}>{isSalary ? "Pay salary" : "Give advance"}</h2>
          <span className={styles.rowSub}>
            {[employee.full_name, employee.code, employee.department?.name, employee.branch.name].filter(Boolean).join(" · ")}
          </span>
        </div>
        <span className={styles.pill} data-tone={isSalary ? "ok" : "advance"} lang="ne" style={{ fontSize: 12 }}>
          {isSalary ? "तलब" : "पेश्की"}
        </span>
      </div>

      {!done || isSalary ? typeToggle : null}

      {isSalary ? (
        <SalaryPayForm key={employee.id} employee={employee} variant="phone" manageModes={isAdmin} onCancel={onClose} onDone={onClose} />
      ) : done ? (
        <>
          <div className={shared.doneBox} style={{ padding: "18px 0" }} role="status">
            <span className={shared.doneBadge} data-tone={done.payment.kind}>
              <Icon name="check" size={30} />
            </span>
            <strong style={{ fontSize: 19 }}>{done.payment.kind === "salary" ? "Salary paid" : "Advance saved"}</strong>
            <span className={shared.doneAmount} data-tone={done.payment.kind} style={{ fontSize: 28 }}>
              {formatRs(done.payment.amount)}
            </span>
            <span className={styles.rowSub} lang="ne">
              {done.payment.payment_mode.name} · {formatBs(done.payment.date.bs, "%B %-d, %Y", "ne")} · receipt {done.payment.receipt_no}
            </span>
            <span style={{ fontSize: 13, color: "var(--pill-low-fg)" }}>
              {monthName(done.payment.month)} still due: {formatRs(done.due_after)}
            </span>
          </div>
          <div className={styles.actions2}>
            <button type="button" className={styles.sheetCancel} onClick={() => window.open(receiptUrl(done.payment.id), "_blank", "noopener")}>
              Share receipt
            </button>
            <button type="button" className={styles.saveBig} style={{ minHeight: 48 }} onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <div className={styles.tiles3}>
            <div className={shared.tile} data-tone="ok">
              <span className={shared.tileLabel} style={{ fontSize: 10 }}>
                Earned · {month ? monthName(month) : ""}
              </span>
              <span className={shared.tileValue} style={{ fontSize: 14 }}>
                {s ? formatAmount(s.earned_so_far) : "…"}
              </span>
            </div>
            <div className={shared.tile} data-tone="advance">
              <span className={shared.tileLabel} style={{ fontSize: 10 }}>
                Already paid
              </span>
              <span className={shared.tileValue} style={{ fontSize: 14 }}>
                {s ? formatAmount(s.paid_this_month) : "…"}
              </span>
            </div>
            <div className={shared.tile} data-tone="low">
              <span className={shared.tileLabel} style={{ fontSize: 10 }}>
                Can give now
              </span>
              <span className={shared.tileValue} style={{ fontSize: 14 }}>
                {s ? formatAmount(room) : "…"}
              </span>
            </div>
          </div>
          <div className={`${styles.field} ${styles.amountField}${over ? ` ${styles.amountOver}` : ""}`}>
            <span style={{ fontSize: 15, color: "var(--color-muted)" }}>Rs</span>
            <input inputMode="numeric" aria-label="Amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} placeholder="0" autoComplete="off" />
          </div>
          <div className={shared.chips}>
            {quick.map((q) => (
              <button key={q.label} type="button" className={shared.chipSmall} data-tone="advance" aria-pressed={amountNumber === q.value} onClick={() => setAmount(String(q.value))}>
                {q.label}
              </button>
            ))}
          </div>
          {over ? <span className={shared.warn}>More than earned so far — at most {formatRs(room)} can be given now.</span> : null}
          {effectiveMode ? (
            <PaidByPicker
              modes={modes.data ?? []}
              value={effectiveMode.id}
              onChange={setModeId}
              type="advance"
              variant="other"
              manageHref={isAdmin ? "/admin/payment-modes" : null}
              reference={reference}
              onReference={setReference}
            />
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div className={styles.kvLine}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Recent payments</span>
              <span className={styles.rowSub}>last {recent.length}</span>
            </div>
            <div className={styles.recentBox}>
              {recent.length === 0 ? <span className={styles.rowSub} style={{ padding: 10 }}>No payments yet.</span> : null}
              {recent.map((p) => (
                <div key={p.id} className={styles.recentRow}>
                  <span className={styles.pill} data-tone={p.kind === "advance" ? "advance" : "ok"} style={{ width: 58, textAlign: "center", flex: "none" }}>
                    {p.kind === "advance" ? "Advance" : "Salary"}
                  </span>
                  <span className={styles.txText}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>
                      {formatBsShort(p.date.bs)} · {monthName(p.month)}
                    </span>
                    <span className={styles.rowSub} style={{ fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {p.payment_mode.name}
                      {p.reference ? ` · ${p.reference}` : ""} · by {p.recorded_by}
                    </span>
                  </span>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 700 }}>
                    {formatAmount(p.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {error ? (
            <p className={shared.formError} role="alert">
              {error}
            </p>
          ) : null}
          <button type="button" className={styles.saveBig} data-type="advance" disabled={!canSave} onClick={() => void save()}>
            {saving ? "Saving…" : valid ? `Give Rs ${formatAmount(amountNumber)} advance` : "Enter an amount"}
          </button>
        </>
      )}
    </BottomSheet>
  );
}
