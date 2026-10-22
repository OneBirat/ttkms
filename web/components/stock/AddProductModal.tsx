"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/ui/Modal";
import { BsDateInput } from "@/components/ui/BsDateInput";
import * as api from "./api";
import { findDuplicateProduct, isDuplicateVariation, plural, toInt } from "./helpers";
import { messageOf } from "./useAsync";
import {
  STOCK_UNITS,
  StockApiError,
  VARIATIONS_BY,
  type Product,
  type StockUnit,
  type VariationsBy,
} from "./types";
import shared from "./stock.module.css";
import styles from "./modals.module.css";

export interface AddProductModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (product: Product) => void;
  /** Existing products, for the duplicate-name check while typing. */
  existing: Pick<Product, "id" | "name">[];
  /** Default "Opening as of" date (today, BS). */
  todayBs: string;
}

interface DraftRow {
  name: string;
  opening: string;
  reorder: string;
  isNew: boolean;
}

/**
 * "Add product" popup (docs/design/AddProduct.dc.html): a product with its
 * variations and their opening stock, saved in one go.
 */
export function AddProductModal({ open, onClose, onSaved, existing, todayBs }: AddProductModalProps) {
  const id = useId();
  const [name, setName] = useState("");
  const [by, setBy] = useState<VariationsBy>("Capacity");
  const [unit, setUnit] = useState<StockUnit>("pcs");
  const [dateBs, setDateBs] = useState(todayBs);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setBy("Capacity");
    setUnit("pcs");
    setDateBs(todayBs);
    setRows([]);
    setDraft("");
    setSaving(false);
    setServerError(null);
  }, [open, todayBs]);

  const duplicate = findDuplicateProduct(existing, name);
  const draftDuplicate = isDuplicateVariation(
    rows.map((r) => r.name),
    draft,
  );
  const total = rows.reduce((a, r) => a + toInt(r.opening), 0);
  const zeros = rows.filter((r) => toInt(r.opening) === 0).length;
  const blocked = !!duplicate || !name.trim() || saving;

  const addVariation = () => {
    const text = draft.trim().replace(/\s+/g, " ");
    if (!text || draftDuplicate) return;
    setRows((list) => [
      ...list.map((r) => ({ ...r, isNew: false })),
      { name: text, opening: "", reorder: "5", isNew: true },
    ]);
    setDraft("");
  };

  const update = (index: number, patch: Partial<DraftRow>) =>
    setRows((list) => list.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (blocked) return;
    setSaving(true);
    setServerError(null);
    try {
      const product = await api.createProduct({
        name: name.trim(),
        variations_by: by,
        unit,
        opening_date_bs: dateBs,
        variations: rows.map((r) => ({
          name: r.name,
          opening: toInt(r.opening),
          reorder_level: toInt(r.reorder),
        })),
      });
      onSaved(product);
      onClose();
    } catch (error) {
      setServerError(error instanceof StockApiError ? error.message : messageOf(error));
      setSaving(false);
    }
  };

  const note = rows.length
    ? `Saves ${plural(rows.length, "stock item")} under "${name.trim() || "Product"}" and records ${total} pcs of opening stock${zeros ? ` (${zeros} at 0)` : ""} dated ${dateBs}.`
    : `Saves "${name.trim() || "Product"}" as a single item with 0 opening stock.`;

  return (
    <Modal open={open} title="Add product" onClose={onClose} size="md">
      <form className={styles.form} onSubmit={submit} noValidate>
        <div className={shared.fieldCol}>
          <label htmlFor={`${id}-name`} className={shared.fieldLabel}>
            Product name
          </label>
          <div className={`field ${duplicate ? shared.fieldError : ""}`}>
            <input
              id={`${id}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Pressure pan"
              aria-invalid={duplicate ? true : undefined}
              aria-describedby={duplicate ? `${id}-name-err` : undefined}
              autoComplete="off"
            />
          </div>
          {duplicate ? (
            <span id={`${id}-name-err`} role="alert" className={shared.errorText}>
              &quot;{duplicate.name}&quot; already exists. Open it from Items to add a variation instead.
            </span>
          ) : null}
        </div>

        <div className={styles.grid3}>
          <div className={shared.fieldCol}>
            <label htmlFor={`${id}-by`} className={shared.fieldLabel}>
              Variations by
            </label>
            <div className="field">
              <select id={`${id}-by`} value={by} onChange={(e) => setBy(e.target.value as VariationsBy)}>
                {VARIATIONS_BY.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className={shared.fieldCol}>
            <label htmlFor={`${id}-unit`} className={shared.fieldLabel}>
              Stock unit
            </label>
            <div className="field">
              <select id={`${id}-unit`} value={unit} onChange={(e) => setUnit(e.target.value as StockUnit)}>
                {STOCK_UNITS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className={shared.fieldCol}>
            <BsDateInput
              name="opening_date_bs"
              label="Opening as of (BS)"
              value={dateBs}
              onChange={setDateBs}
              id={`${id}-date`}
            />
          </div>
        </div>

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>
            Variations <span>· {rows.length}</span>
          </legend>
          <div className={styles.rows}>
            <div className={styles.rowHead} aria-hidden="true">
              <span>Variation</span>
              <span>Opening stock</span>
              <span>Reorder at</span>
              <span />
            </div>
            {rows.map((row, index) => (
              <div key={row.name} className={`${styles.row} ${row.isNew ? styles.rowNew : ""}`}>
                <div className={styles.rowName}>
                  <span>{row.name}</span>
                  {row.isNew ? <span className={styles.newBadge}>New</span> : null}
                </div>
                <div className={`field ${styles.numField}`}>
                  <input
                    aria-label={`Opening stock for ${row.name}`}
                    inputMode="numeric"
                    placeholder="0"
                    value={row.opening}
                    onChange={(e) => update(index, { opening: e.target.value })}
                  />
                  <span>pcs</span>
                </div>
                <div className={`field ${styles.numField}`}>
                  <input
                    aria-label={`Reorder level for ${row.name}`}
                    inputMode="numeric"
                    value={row.reorder}
                    onChange={(e) => update(index, { reorder: e.target.value })}
                  />
                </div>
                <button
                  type="button"
                  className={shared.iconButton}
                  aria-label={`Remove ${row.name}`}
                  onClick={() => setRows((list) => list.filter((_, i) => i !== index))}
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ))}
            {rows.length === 0 ? (
              <p className={styles.empty}>No variations yet. Add one below, or save as a single item.</p>
            ) : null}
          </div>
          <div className={styles.addRow}>
            <div className="field">
              <input
                aria-label="New variation"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addVariation();
                  }
                }}
                placeholder="e.g. 7.5 L"
                aria-invalid={draftDuplicate ? true : undefined}
              />
            </div>
            <button type="button" className={styles.addButton} onClick={addVariation}>
              + Add variation
            </button>
          </div>
          {draftDuplicate ? (
            <span role="alert" className={shared.errorText}>
              &quot;{draft.trim()}&quot; is already in this product. Duplicates aren&apos;t allowed.
            </span>
          ) : null}
          <span className={shared.hint}>
            Opening stock left blank is saved as 0. You can record stock later from Stock entry.
          </span>
        </fieldset>

        <p className={shared.note} aria-live="polite">
          {note}
        </p>
        {serverError ? (
          <p role="alert" className={shared.errorText}>
            {serverError}
          </p>
        ) : null}

        <div className={styles.footer}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={blocked} aria-disabled={blocked}>
            {saving ? "Saving…" : "Save product"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
