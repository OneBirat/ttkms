"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { formatBs, kathmanduDateBs, kathmanduTime } from "@/lib/bs";
import { updatePaymentNote } from "../api";
import { monthName } from "../_lib/months";
import { payrollErrorMessage } from "../_lib/usePayroll";
import type { LedgerEntry, LedgerGroupMonth, Payment } from "../types";
import styles from "./remarks.module.css";

/** Months of a bulk salary payment (one ledger row for several months), else 0. */
export function bulkMonths(entry: Pick<LedgerEntry, "group_months">): number {
  const n = entry.group_months?.length ?? 0;
  return n > 1 ? n : 0;
}

/** "Kartik 9, 2083, 3:07 pm" (Kathmandu) from an ISO timestamp. */
export function noteWhen(iso: string): string {
  const { hour, minute } = kathmanduTime(iso);
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${formatBs(kathmanduDateBs(iso))}, ${h}:${String(minute).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`;
}

/** "Note · Ram Admin · Kartik 9, 2083, 3:07 pm" */
export function noteMeta(payment: Pick<Payment, "note_updated_by" | "note_updated_at">): string {
  return ["Note", payment.note_updated_by || null, payment.note_updated_at ? noteWhen(payment.note_updated_at) : null]
    .filter(Boolean)
    .join(" · ");
}

export interface PaymentRemarksProps {
  payment: Payment;
  /** The ledger row's months (bulk payments show a ✓ chip per month they cleared). */
  months?: LedgerGroupMonth[] | null;
  /** salary_advances: add / edit the note. */
  canEdit: boolean;
  /** Called with the saved payment (the screens reload through the api's change event). */
  onSaved?: (payment: Payment) => void;
}

/**
 * Under every payment row of the employee ledger: the grey read-only System remark (written by
 * the server at creation, never editable) and the optional human note (pale yellow) with Edit /
 * "+ Add note" and an inline editor. Notes apply to the whole payment group and are audit-logged.
 */
export function PaymentRemarks({ payment, months, canEdit, onSaved }: PaymentRemarksProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(payment.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleared = (months?.length ?? 0) > 1 ? months!.filter((m) => m.cleared) : [];

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await updatePaymentNote(payment.id, draft.trim());
      setEditing(false);
      onSaved?.(saved);
    } catch (err) {
      setError(payrollErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.remarks}>
      <div className={styles.system} data-testid="system-remark">
        <span className={styles.systemLabel}>
          <Icon name="lock" size={12} />
          System
        </span>
        <span className={styles.systemText}>{payment.system_remark}</span>
        {cleared.length ? (
          <span className={styles.chips}>
            {cleared.map((m) => (
              <span key={`${m.for_year}-${m.for_month}`} className={styles.clearedChip}>
                ✓ {monthName({ bs_year: m.for_year, bs_month: m.for_month })}
              </span>
            ))}
          </span>
        ) : null}
      </div>

      {editing ? (
        <div className={styles.editor}>
          <textarea
            className={styles.textarea}
            aria-label={`Note for ${payment.receipt_no}`}
            value={draft}
            maxLength={500}
            rows={2}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
          />
          {error ? (
            <span role="alert" className={styles.error}>
              {error}
            </span>
          ) : null}
          <span className={styles.editorActions}>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              disabled={saving}
              onClick={() => {
                setEditing(false);
                setDraft(payment.note ?? "");
                setError(null);
              }}
            >
              Cancel
            </button>
            <button type="button" className="btn btn--sm btn--primary" disabled={saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save note"}
            </button>
          </span>
        </div>
      ) : payment.note ? (
        <div className={styles.note} data-testid="payment-note">
          <span className={styles.noteText}>{payment.note}</span>
          <span className={styles.noteFoot}>
            <span className={styles.noteMeta}>{noteMeta(payment)}</span>
            {canEdit ? (
              <button
                type="button"
                className={styles.noteEdit}
                onClick={() => {
                  setDraft(payment.note ?? "");
                  setEditing(true);
                }}
              >
                Edit
              </button>
            ) : null}
          </span>
        </div>
      ) : canEdit ? (
        <button
          type="button"
          className={styles.addNote}
          onClick={() => {
            setDraft("");
            setEditing(true);
          }}
        >
          + Add note
        </button>
      ) : null}
    </div>
  );
}
