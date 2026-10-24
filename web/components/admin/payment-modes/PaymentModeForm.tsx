"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/ui/Modal";
import { ApiError, errorMessage } from "@/lib/api";
import { cleanModeInput, EDITABLE_KINDS, MODE_KINDS, modeError } from "../modeKinds";
import { createPaymentMode, updatePaymentMode } from "../paymentModesApi";
import type { EditableModeType, PaymentMode, PaymentModeInput } from "../types";
import styles from "../components/admin.module.css";

export type ModeFormMode = { kind: "create" } | { kind: "edit"; mode: PaymentMode };

export interface PaymentModeFormProps {
  mode: ModeFormMode;
  /** Current modes, for the "what staff see" preview. */
  modes: PaymentMode[];
  layout: "modal" | "sheet";
  onClose: () => void;
  onSaved: (mode: PaymentMode, created: boolean) => void;
}

function initial(mode: ModeFormMode): PaymentModeInput {
  if (mode.kind === "edit") {
    return {
      type: (mode.mode.type === "cash" ? "bank" : mode.mode.type) as EditableModeType,
      name: mode.mode.name,
      details: mode.mode.details,
      use_salary: mode.mode.use_salary,
      use_advance: mode.mode.use_advance,
    };
  }
  return { type: "bank", name: "", details: "", use_salary: true, use_advance: true };
}

/**
 * "+ Add payment method" / "Edit <mode>" (design/final/AdminPaymentModes.dc.html);
 * on the phone the shorter bottom-sheet form from PayrollMobile's settings
 * screen (type, name, optional details, Cancel / Add).
 */
export function PaymentModeForm({ mode, modes, layout, onClose, onSaved }: PaymentModeFormProps) {
  const editing = mode.kind === "edit" ? mode.mode : null;
  const [form, setForm] = useState<PaymentModeInput>(() => initial(mode));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const sheetRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (layout !== "sheet") return;
    const opener = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
      opener?.focus();
    };
  }, [layout]);

  const update = (patch: Partial<PaymentModeInput>) => {
    setError(null);
    setForm((current) => ({ ...current, ...patch }));
  };

  const kind = MODE_KINDS[form.type];
  const problem = modeError(form);
  const title = editing ? `Edit ${editing.name}` : layout === "sheet" ? "Add payment mode" : "Add payment method";
  const saveLabel = busy ? "Saving…" : editing ? "Save changes" : layout === "sheet" ? "Add payment mode" : "Add payment method";

  const save = async () => {
    setTouched(true);
    if (problem) return;
    setBusy(true);
    setError(null);
    const payload = cleanModeInput(form);
    try {
      const saved = editing
        ? await updatePaymentMode(editing.id, payload)
        : await createPaymentMode(payload);
      onSaved(saved, !editing);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : errorMessage(err));
      setBusy(false);
    }
  };

  const onSheetKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  const kindButtons = (chips: boolean) => (
    <div className={chips ? styles.kindChips : styles.kinds} role="group" aria-label="Type">
      {EDITABLE_KINDS.map((type) => (
        <button
          key={type}
          type="button"
          className={styles.kind}
          aria-pressed={form.type === type}
          onClick={() => update({ type })}
        >
          {MODE_KINDS[type].label}
        </button>
      ))}
    </div>
  );

  const errorBox =
    error || (touched && problem) ? (
      <p className={`${styles.note} ${styles.noteDanger}`} role="alert">
        {error ?? problem}
      </p>
    ) : null;

  // What staff see when paying: Cash | Other ▾ and the active modes (plus this draft).
  const previewRows = [
    ...modes.filter((m) => m.active && !m.is_builtin && m.id !== editing?.id),
    ...(form.name.trim()
      ? [{ id: -1, type: form.type, name: form.name.trim(), details: form.details?.trim() || "—" }]
      : []),
  ];

  if (layout === "sheet") {
    return (
      <div className={styles.bottomSheetBackdrop}>
        <div aria-hidden="true" style={{ flex: 1, minHeight: 40 }} onClick={onClose} />
        <section
          ref={sheetRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${id}-title`}
          tabIndex={-1}
          className={styles.bottomSheet}
          onKeyDown={onSheetKey}
        >
          <span aria-hidden="true" className={styles.grabber} />
          <div className={styles.bottomSheetHead}>
            <h2 id={`${id}-title`} className={styles.bottomSheetTitle}>
              {title}
            </h2>
            <button type="button" aria-label="Close" className={styles.sheetClose} onClick={onClose}>
              <Icon name="close" size={22} />
            </button>
          </div>
          <span className={styles.useLabel}>Type</span>
          {kindButtons(true)}
          <div className={styles.field}>
            <label htmlFor={`${id}-name`} className={styles.fieldLabel}>
              Name
            </label>
            <div className="field">
              <input
                id={`${id}-name`}
                placeholder="e.g. Global IME Bank"
                value={form.name}
                onChange={(event) => update({ name: event.target.value })}
              />
            </div>
          </div>
          <div className={styles.field}>
            <label htmlFor={`${id}-details`} className={styles.fieldLabel}>
              Details <span className={styles.fieldHint}>(optional)</span>
            </label>
            <div className="field">
              <input
                id={`${id}-details`}
                placeholder="A/c ··2231 or wallet number"
                value={form.details ?? ""}
                onChange={(event) => update({ details: event.target.value })}
              />
            </div>
          </div>
          {errorBox}
          <div className={styles.sheetActions}>
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary"
              aria-disabled={Boolean(problem)}
              disabled={busy}
              onClick={() => void save()}
            >
              {saveLabel}
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <Modal open title={title} onClose={onClose} size="sm">
      <div className={styles.form}>
        <div className={styles.field}>
          <span className={styles.useLabel}>Type</span>
          {kindButtons(false)}
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-name`} className={styles.fieldLabel}>
            Name
          </label>
          <div className="field">
            <input
              id={`${id}-name`}
              placeholder="e.g. Global IME Bank"
              value={form.name}
              aria-invalid={touched && !form.name.trim() ? true : undefined}
              onChange={(event) => update({ name: event.target.value })}
            />
          </div>
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-details`} className={styles.fieldLabel}>
            {kind.detailsLabel} <span className={styles.fieldHint}>shown on receipts</span>
          </label>
          <div className="field">
            <input
              id={`${id}-details`}
              placeholder={kind.detailsPlaceholder}
              value={form.details ?? ""}
              onChange={(event) => update({ details: event.target.value })}
            />
          </div>
        </div>
        <div className={styles.useList}>
          <span className={styles.useLabel}>Can be used for</span>
          <label className={styles.check} style={{ minHeight: 32 }}>
            <input
              type="checkbox"
              checked={form.use_salary}
              onChange={(event) => update({ use_salary: event.target.checked })}
            />
            Salary payments
          </label>
          <label className={styles.check} style={{ minHeight: 32 }}>
            <input
              type="checkbox"
              checked={form.use_advance}
              onChange={(event) => update({ use_advance: event.target.checked })}
            />
            Advances
          </label>
        </div>
        {errorBox}
        <div className={styles.formGrid2}>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            aria-disabled={Boolean(problem)}
            disabled={busy}
            onClick={() => void save()}
          >
            {saveLabel}
          </button>
        </div>
        <div className={styles.preview}>
          <span className={styles.previewTitle}>Preview · what staff see</span>
          <div className={styles.previewChoice}>
            <span className={styles.previewBtn}>Cash</span>
            <span className={`${styles.previewBtn} ${styles.previewBtnOn}`}>Other ▾</span>
          </div>
          <div className={styles.previewList}>
            {previewRows.length === 0 ? (
              <div className={styles.previewRow}>
                <span className="muted">Nothing under Other yet.</span>
              </div>
            ) : (
              previewRows.map((row) => (
                <div key={row.id} className={styles.previewRow}>
                  <span
                    className={`${styles.modeIco} ${styles.modeIcoSm}`}
                    style={{ background: MODE_KINDS[row.type].bg, color: MODE_KINDS[row.type].fg }}
                    aria-hidden="true"
                  >
                    {MODE_KINDS[row.type].symbol}
                  </span>
                  <span className={styles.previewRowName}>{row.name}</span>
                  <span className={styles.previewRowDetails}>{row.details ?? "—"}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
