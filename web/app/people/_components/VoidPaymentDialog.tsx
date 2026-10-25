"use client";

import { useEffect, useId, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useSession } from "@/lib/session";
import { voidPayment } from "../api";
import { formatRs } from "../_lib/helpers";
import { monthLabel } from "../_lib/months";
import { payrollErrorMessage } from "../_lib/usePayroll";
import type { Payment } from "../types";
import { Field, TextInput } from "./FormBits";
import shared from "./payroll.module.css";

/** Only admins void payments (POST /api/payroll/payments/{id}/void checks the same). */
export function useCanVoid(): boolean {
  const { user } = useSession();
  return user?.role === "admin";
}

/** "Voided — reason" under a struck-through payment; null for a normal payment. */
export function VoidedNote({ payment }: { payment: Pick<Payment, "voided" | "void_reason"> }) {
  if (!payment.voided) return null;
  return <span className={shared.voidedNote}>Voided — {payment.void_reason}</span>;
}

export interface VoidPaymentDialogProps {
  payment: Payment | null;
  /** Shown in the title line ("Anita Gurung"). */
  employeeName?: string;
  onClose: () => void;
  onVoided?: (payment: Payment) => void;
}

/**
 * "Void payment": the reason is required and the void cannot be undone. The payment stays listed
 * (struck through) and keeps its receipt number, but counts for nothing from then on.
 */
export function VoidPaymentDialog({ payment, employeeName, onClose, onVoided }: VoidPaymentDialogProps) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setReason("");
    setError(null);
    setBusy(false);
  }, [payment?.id]);
  if (!payment) return null;
  const ok = reason.trim().length > 0;
  const save = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      const voided = await voidPayment(payment.id, reason.trim());
      onVoided?.(voided);
      onClose();
    } catch (err) {
      setError(payrollErrorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Modal open title="Void payment" onClose={onClose} size="sm">
      <div className={shared.stack}>
        <p style={{ fontSize: 14, lineHeight: 1.5 }}>
          <b>{payment.receipt_no}</b> · {payment.kind === "advance" ? "Advance" : "Salary"} {formatRs(payment.amount)} for{" "}
          {monthLabel(payment.month)}
          {employeeName ? ` · ${employeeName}` : ""}
        </p>
        <p className={shared.note} style={{ fontSize: 13, lineHeight: 1.5 }}>
          The payment stays in the lists, struck through, and keeps its receipt number — but it no longer counts as paid,
          so the balance due goes back up. This cannot be undone.
        </p>
        <Field id={`${id}-reason`} label="Reason (required)">
          <TextInput
            id={`${id}-reason`}
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Test entry, entered twice"
            autoComplete="off"
          />
        </Field>
        {error ? (
          <p role="alert" className={shared.formError}>
            {error}
          </p>
        ) : null}
        <div className={shared.footerButtons}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={`btn ${shared.dangerBtn}`} disabled={!ok || busy} onClick={save}>
            {busy ? "Voiding…" : "Void payment"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
