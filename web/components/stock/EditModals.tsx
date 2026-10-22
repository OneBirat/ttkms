"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/Modal";
import { BsDateInput } from "@/components/ui/BsDateInput";
import * as api from "./api";
import { findDuplicateProduct, isDuplicateVariation, toInt } from "./helpers";
import { messageOf } from "./useAsync";
import {
  STOCK_UNITS,
  VARIATIONS_BY,
  type Product,
  type StockUnit,
  type Variation,
  type VariationsBy,
} from "./types";
import shared from "./stock.module.css";
import styles from "./modals.module.css";

function Footer({ saving, disabled, onClose, label }: { saving: boolean; disabled: boolean; onClose: () => void; label: string }) {
  return (
    <div className={styles.footer}>
      <button type="button" className="btn" onClick={onClose}>
        Cancel
      </button>
      <button type="submit" className="btn btn--primary" disabled={disabled || saving} aria-disabled={disabled || saving}>
        {saving ? "Saving…" : label}
      </button>
    </div>
  );
}

// ------------------------------------------------------------ variation

export interface EditVariationModalProps {
  variation: Variation | null;
  product: Product | null;
  onClose: () => void;
  onSaved: (variation: Variation) => void;
}

/** Rename a variation or change its reorder level ("Edit" in the Items tables). */
export function EditVariationModal({ variation, product, onClose, onSaved }: EditVariationModalProps) {
  const id = useId();
  const [name, setName] = useState("");
  const [reorder, setReorder] = useState("5");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!variation) return;
    setName(variation.name);
    setReorder(String(variation.reorder_level));
    setSaving(false);
    setError(null);
  }, [variation]);

  const others = product?.variations.filter((v) => v.id !== variation?.id).map((v) => v.name) ?? [];
  const duplicate = isDuplicateVariation(others, name);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!variation || duplicate || !name.trim()) return;
    setSaving(true);
    try {
      const saved = await api.updateVariation(variation.id, {
        name: name.trim(),
        reorder_level: toInt(reorder),
      });
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(messageOf(err));
      setSaving(false);
    }
  };

  return (
    <Modal open={variation !== null} title={`Edit ${product?.name ?? ""} · ${variation?.name ?? ""}`} onClose={onClose} size="sm">
      <form className={styles.form} onSubmit={submit} noValidate>
        <div className={shared.fieldCol}>
          <label htmlFor={`${id}-name`} className={shared.fieldLabel}>
            Variation
          </label>
          <div className={`field ${duplicate ? shared.fieldError : ""}`}>
            <input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={duplicate || undefined} />
          </div>
          {duplicate ? (
            <span role="alert" className={shared.errorText}>
              &quot;{name.trim()}&quot; is already in this product. Duplicates aren&apos;t allowed.
            </span>
          ) : null}
        </div>
        <div className={shared.fieldCol}>
          <label htmlFor={`${id}-reorder`} className={shared.fieldLabel}>
            Reorder at (pcs)
          </label>
          <div className={`field ${styles.numField}`}>
            <input id={`${id}-reorder`} inputMode="numeric" value={reorder} onChange={(e) => setReorder(e.target.value)} />
          </div>
          <span className={shared.hint}>Status turns Low at or below this number and Out at 0.</span>
        </div>
        {error ? (
          <p role="alert" className={shared.errorText}>
            {error}
          </p>
        ) : null}
        <Footer saving={saving} disabled={duplicate || !name.trim()} onClose={onClose} label="Save changes" />
      </form>
    </Modal>
  );
}

// -------------------------------------------------------- add variation

export interface AddVariationModalProps {
  product: Product | null;
  todayBs: string;
  onClose: () => void;
  onSaved: (product: Product) => void;
}

/** "+ Add variation to <product>" from the grouped Items view. */
export function AddVariationModal({ product, todayBs, onClose, onSaved }: AddVariationModalProps) {
  const id = useId();
  const [name, setName] = useState("");
  const [opening, setOpening] = useState("");
  const [reorder, setReorder] = useState("5");
  const [dateBs, setDateBs] = useState(todayBs);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!product) return;
    setName("");
    setOpening("");
    setReorder("5");
    setDateBs(todayBs);
    setSaving(false);
    setError(null);
  }, [product, todayBs]);

  const duplicate = isDuplicateVariation(product?.variations.map((v) => v.name) ?? [], name);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!product || duplicate || !name.trim()) return;
    setSaving(true);
    try {
      const saved = await api.addVariation({
        product_id: product.id,
        opening_date_bs: dateBs,
        variation: { name: name.trim(), opening: toInt(opening), reorder_level: toInt(reorder) },
      });
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(messageOf(err));
      setSaving(false);
    }
  };

  return (
    <Modal open={product !== null} title={`Add variation to ${product?.name ?? ""}`} onClose={onClose} size="sm">
      <form className={styles.form} onSubmit={submit} noValidate>
        <div className={shared.fieldCol}>
          <label htmlFor={`${id}-name`} className={shared.fieldLabel}>
            {product?.variations_by ?? "Variation"}
          </label>
          <div className={`field ${duplicate ? shared.fieldError : ""}`}>
            <input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 7.5 L" aria-invalid={duplicate || undefined} />
          </div>
          {duplicate ? (
            <span role="alert" className={shared.errorText}>
              &quot;{name.trim()}&quot; is already in this product. Duplicates aren&apos;t allowed.
            </span>
          ) : null}
        </div>
        <div className={styles.grid3}>
          <div className={shared.fieldCol}>
            <label htmlFor={`${id}-opening`} className={shared.fieldLabel}>
              Opening stock
            </label>
            <div className={`field ${styles.numField}`}>
              <input id={`${id}-opening`} inputMode="numeric" placeholder="0" value={opening} onChange={(e) => setOpening(e.target.value)} />
              <span>pcs</span>
            </div>
          </div>
          <div className={shared.fieldCol}>
            <label htmlFor={`${id}-reorder`} className={shared.fieldLabel}>
              Reorder at
            </label>
            <div className={`field ${styles.numField}`}>
              <input id={`${id}-reorder`} inputMode="numeric" value={reorder} onChange={(e) => setReorder(e.target.value)} />
            </div>
          </div>
          <div className={shared.fieldCol}>
            <BsDateInput name="opening_date_bs" label="Opening as of (BS)" value={dateBs} onChange={setDateBs} id={`${id}-date`} />
          </div>
        </div>
        {error ? (
          <p role="alert" className={shared.errorText}>
            {error}
          </p>
        ) : null}
        <Footer saving={saving} disabled={duplicate || !name.trim()} onClose={onClose} label="Add variation" />
      </form>
    </Modal>
  );
}

// -------------------------------------------------------------- product

export interface EditProductModalProps {
  product: Product | null;
  existing: Pick<Product, "id" | "name">[];
  onClose: () => void;
  onSaved: (product: Product) => void;
}

/** "Edit product" on the product detail page: name, variations-by, unit. */
export function EditProductModal({ product, existing, onClose, onSaved }: EditProductModalProps) {
  const id = useId();
  const [name, setName] = useState("");
  const [by, setBy] = useState<VariationsBy>("Capacity");
  const [unit, setUnit] = useState<StockUnit>("pcs");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!product) return;
    setName(product.name);
    setBy(product.variations_by);
    setUnit(product.unit);
    setSaving(false);
    setError(null);
  }, [product]);

  const duplicate = product ? findDuplicateProduct(existing, name, product.id) : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!product || duplicate || !name.trim()) return;
    setSaving(true);
    try {
      const saved = await api.updateProduct(product.id, { name: name.trim(), variations_by: by, unit });
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(messageOf(err));
      setSaving(false);
    }
  };

  return (
    <Modal open={product !== null} title="Edit product" onClose={onClose} size="sm">
      <form className={styles.form} onSubmit={submit} noValidate>
        <div className={shared.fieldCol}>
          <label htmlFor={`${id}-name`} className={shared.fieldLabel}>
            Product name
          </label>
          <div className={`field ${duplicate ? shared.fieldError : ""}`}>
            <input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={duplicate ? true : undefined} />
          </div>
          {duplicate ? (
            <span role="alert" className={shared.errorText}>
              &quot;{duplicate.name}&quot; already exists.
            </span>
          ) : null}
        </div>
        <div className={shared.formGrid}>
          <div className={shared.fieldCol}>
            <label htmlFor={`${id}-by`} className={shared.fieldLabel}>
              Variations by
            </label>
            <div className="field">
              <select id={`${id}-by`} value={by} onChange={(e) => setBy(e.target.value as VariationsBy)}>
                {VARIATIONS_BY.map((o) => (
                  <option key={o} value={o}>
                    {o}
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
                {STOCK_UNITS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        {error ? (
          <p role="alert" className={shared.errorText}>
            {error}
          </p>
        ) : null}
        <Footer saving={saving} disabled={!!duplicate || !name.trim()} onClose={onClose} label="Save changes" />
      </form>
    </Modal>
  );
}
