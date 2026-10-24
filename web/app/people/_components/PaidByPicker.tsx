"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Field, TextInput } from "./FormBits";
import type { PaymentMode, PaymentModeType, PaymentType } from "../types";
import styles from "./payroll.module.css";

export interface PaidByPickerProps {
  modes: PaymentMode[];
  /** Selected payment_mode_id. */
  value: number;
  onChange: (id: number) => void;
  /** Hides modes not set up for this payment type. */
  type: PaymentType;
  /** "grid": every active mode as a button (desktop). "other": Cash | Other ▾ with a list (phone). */
  variant?: "grid" | "other";
  /** Shown under the list for admins ("Manage payment modes"). */
  manageHref?: string | null;
  reference: string;
  onReference: (value: string) => void;
  /** Hide the reference field (the mobile sheet keeps it short). */
  noReference?: boolean;
}

export const MODE_SYMBOL: Record<PaymentModeType, string> = {
  cash: "Rs",
  bank: "🏦",
  wallet: "W",
  qr: "▦",
  cheque: "✎",
};

export const MODE_KIND: Record<PaymentModeType, string> = {
  cash: "Cash",
  bank: "Bank",
  wallet: "Wallet",
  qr: "QR",
  cheque: "Cheque",
};

/** Modes allowed for a payment type, Cash first. */
export function modesFor(modes: PaymentMode[], type: PaymentType): PaymentMode[] {
  return modes.filter((m) => m.active && (type === "salary" ? m.use_salary : m.use_advance));
}

function needsReference(mode: PaymentMode | undefined): boolean {
  return Boolean(mode && (mode.type === "bank" || mode.type === "cheque"));
}

/**
 * "Paid by": Cash is built in; the other active payment modes come from admin
 * (GET /api/admin/payment-modes?active=1). Bank and cheque ask for a reference.
 */
export function PaidByPicker({
  modes,
  value,
  onChange,
  type,
  variant = "grid",
  manageHref = null,
  reference,
  onReference,
  noReference = false,
}: PaidByPickerProps) {
  const uid = useId();
  const [listOpen, setListOpen] = useState(false);
  const allowed = modesFor(modes, type);
  const cash = allowed.find((m) => m.type === "cash");
  const others = allowed.filter((m) => m.type !== "cash");
  const selected = allowed.find((m) => m.id === value);

  const referenceField =
    !noReference && needsReference(selected) ? (
      <Field id={`${uid}-ref`} label={`${selected?.type === "cheque" ? "Cheque number" : "Bank reference"} (optional)`}>
        <TextInput
          id={`${uid}-ref`}
          value={reference}
          onChange={(e) => onReference(e.target.value)}
          placeholder={selected?.type === "cheque" ? "Cheque no." : "Transfer reference"}
          autoComplete="off"
        />
      </Field>
    ) : null;

  if (variant === "other") {
    const otherOn = Boolean(selected && selected.type !== "cash");
    return (
      <div className={styles.stack} style={{ gap: 8 }}>
        <span className={styles.fieldLabel}>Paid by</span>
        <div className={styles.toggle}>
          <button
            type="button"
            className={styles.toggleOption}
            aria-pressed={!otherOn}
            onClick={() => {
              if (cash) onChange(cash.id);
              setListOpen(false);
            }}
          >
            Cash
          </button>
          <button
            type="button"
            className={styles.toggleOption}
            aria-pressed={otherOn}
            aria-expanded={listOpen}
            disabled={others.length === 0}
            onClick={() => {
              if (!otherOn && others[0]) onChange(others[0].id);
              setListOpen((open) => !open);
            }}
          >
            {otherOn && selected ? selected.name : "Other"} ▾
          </button>
        </div>
        {listOpen ? (
          <div role="radiogroup" aria-label="Other payment modes" className={styles.modeList}>
            {others.map((m) => {
              const on = m.id === value;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={styles.modeRow}
                  onClick={() => {
                    onChange(m.id);
                    setListOpen(false);
                  }}
                >
                  <span className={styles.modeIcon} data-kind={m.type}>
                    {MODE_SYMBOL[m.type]}
                  </span>
                  <span className={styles.modeText}>
                    <span className={styles.modeName}>{m.name}</span>
                    <span className={styles.note}>
                      {m.details ? `${m.details} · ` : ""}
                      {MODE_KIND[m.type]}
                    </span>
                  </span>
                  <span className={styles.modeDot} aria-hidden="true" />
                </button>
              );
            })}
            {manageHref ? (
              <Link href={manageHref} className={styles.modeManage}>
                ⚙ Manage payment modes ›
              </Link>
            ) : null}
          </div>
        ) : null}
        {referenceField}
      </div>
    );
  }

  return (
    <div className={styles.stack} style={{ gap: 8 }}>
      <span className={styles.fieldLabel}>Paid by</span>
      <div role="group" aria-label="Paid by" className={styles.modeGrid}>
        {allowed.map((m) => (
          <button
            key={m.id}
            type="button"
            className={styles.toggleOption}
            aria-pressed={m.id === value}
            title={m.details ?? undefined}
            onClick={() => onChange(m.id)}
          >
            <span>{m.name}</span>
            {m.details ? <span className={styles.toggleSubPlain}>{m.details}</span> : null}
          </button>
        ))}
      </div>
      {manageHref ? (
        <Link href={manageHref} className={styles.note} style={{ alignSelf: "flex-start" }}>
          ⚙ Manage payment modes ›
        </Link>
      ) : null}
      {referenceField}
    </div>
  );
}
