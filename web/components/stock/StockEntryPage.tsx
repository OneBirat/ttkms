"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { BsDateInput } from "@/components/ui/BsDateInput";
import { PageHeader } from "@/components/ui/PageHeader";
import { Segmented } from "@/components/ui/Segmented";
import { AddProductModal } from "./AddProductModal";
import * as api from "./api";
import { bsToAd, formatAdLong, formatBsLong, parseBsIso } from "./calendar";
import { ItemCombobox, type ItemOption } from "./ItemCombobox";
import { plural, toInt } from "./helpers";
import { messageOf, useAsync } from "./useAsync";
import type { MovementType } from "./types";
import shared from "./stock.module.css";
import styles from "./entry.module.css";

const TYPES: { value: MovementType; label: string }[] = [
  { value: "purchase", label: "Purchase" },
  { value: "consumption", label: "Consumption" },
  { value: "opening", label: "Opening stock" },
];

const SAVE_LABEL: Record<MovementType, string> = {
  purchase: "Save purchase",
  consumption: "Save consumption",
  opening: "Save opening stock",
};

interface Row {
  key: number;
  variationId: number | null;
  qty: string;
  remarks: string;
}

let rowSeq = 1;
const newRow = (): Row => ({ key: rowSeq++, variationId: null, qty: "", remarks: "" });

export function StockEntryPage() {
  const [version, setVersion] = useState(0);
  const today = useAsync(() => api.getToday(), "today");
  const products = useAsync(() => api.listProducts(), `products:${version}`);
  const [type, setType] = useState<MovementType>("purchase");
  const [dateBs, setDateBs] = useState("");
  const [reference, setReference] = useState("");
  const [supplier, setSupplier] = useState("");
  const [rows, setRows] = useState<Row[]>(() => [newRow()]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<number | null>(null); // row key that asked for a new item
  const [tab, setTab] = useState<"purchase" | "consumption">("purchase");
  const entries = useAsync(() => api.getTodayEntries(tab), `${tab}:${version}`);

  useEffect(() => {
    if (today.data && !dateBs) setDateBs(today.data.bs);
  }, [today.data, dateBs]);

  const options: ItemOption[] = useMemo(
    () =>
      (products.data?.products ?? []).flatMap((p) =>
        p.variations.map((v) => ({ id: v.id, product: p.name, variation: v.name, stock: v.in_stock })),
      ),
    [products.data],
  );
  const optionById = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);

  const parsedDate = parseBsIso(dateBs);
  const dateNote = parsedDate ? `${formatBsLong(parsedDate)} · ${formatAdLong(bsToAd(parsedDate))} AD` : "Enter the date as YYYY-MM-DD (BS)";

  // Row problems, in the order the design shows them.
  const problems = rows.map((row, index) => {
    if (row.variationId === null) return "Choose an item.";
    const first = rows.findIndex((r) => r.variationId === row.variationId);
    if (first !== index) return `Already in row ${first + 1}. Merge or change the item.`;
    const qty = toInt(row.qty);
    if (row.qty.trim() === "") return null; // not filled yet, not an error until save
    if (qty <= 0) return "Quantity must be a whole number above 0.";
    const stock = optionById.get(row.variationId)?.stock ?? 0;
    if (type === "consumption" && qty > stock) return `Only ${stock} in stock.`;
    return null;
  });
  const attention = problems.filter(Boolean).length;
  const complete = rows.every((r, i) => !problems[i] && r.qty.trim() !== "");
  const canSave = rows.length > 0 && complete && !!parsedDate && !saving;

  const update = (key: number, patch: Partial<Row>) =>
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const clear = () => {
    setRows([newRow()]);
    setReference("");
    setSupplier("");
    setError(null);
    setSaved(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const result = await api.saveEntry({
        type,
        date_bs: dateBs,
        reference: reference.trim() || null,
        supplier: supplier.trim() || null,
        lines: rows.map((r) => ({ variation_id: r.variationId as number, quantity: toInt(r.qty), remarks: r.remarks.trim() || null })),
      });
      const total = result.movements.reduce((a, m) => a + m.quantity, 0);
      setSaved(`Saved ${plural(result.saved, `${type === "opening" ? "opening stock" : type} entry`, `${type === "opening" ? "opening stock" : type} entries`)} · ${total} pcs.`);
      setRows([newRow()]);
      setReference("");
      setSupplier("");
      if (type !== "opening") setTab(type);
      setVersion((n) => n + 1);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setSaving(false);
    }
  };

  const isPurchaseTab = tab === "purchase";

  return (
    <>
      <PageHeader
        title="Stock entry"
        subtitle="One form for opening stock, purchases and consumption. All rows save together, or none do."
      />
      <div className={styles.layout}>
        <form className={`card ${styles.form}`} onSubmit={submit} noValidate>
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Entry type</legend>
            <Segmented options={TYPES} value={type} onChange={setType} label="Entry type" />
          </fieldset>

          <div className={styles.meta}>
            <div className={shared.fieldCol}>
              <BsDateInput name="date_bs" label="Date (BS)" value={dateBs} onChange={setDateBs} id="entry-date" />
              <span className={shared.hint}>{dateNote}</span>
            </div>
            <div className={shared.fieldCol}>
              <label htmlFor="entry-ref" className={shared.fieldLabel}>
                Bill / reference no. <span className={shared.optional}>(optional)</span>
              </label>
              <div className="field">
                <input id="entry-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. 1042" />
              </div>
            </div>
            <div className={shared.fieldCol}>
              <label htmlFor="entry-supplier" className={shared.fieldLabel}>
                Supplier <span className={shared.optional}>(optional)</span>
              </label>
              <div className="field">
                <input id="entry-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Supplier name" />
              </div>
            </div>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col" style={{ width: 28 }}>
                    #
                  </th>
                  <th scope="col">Item</th>
                  <th scope="col" className={shared.num} style={{ width: 90 }}>
                    In stock
                  </th>
                  <th scope="col" style={{ width: 150 }}>
                    Quantity
                  </th>
                  <th scope="col">Remarks</th>
                  <th scope="col" style={{ width: 44 }}>
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const problem = problems[index];
                  const option = row.variationId !== null ? optionById.get(row.variationId) : undefined;
                  const warnId = `row-${row.key}-warn`;
                  const isDup = problem?.startsWith("Already");
                  return (
                    <tr key={row.key} className={isDup ? styles.rowWarn : undefined}>
                      <td className={styles.rowIndex}>{index + 1}</td>
                      <td>
                        <ItemCombobox
                          options={options}
                          value={row.variationId}
                          onChange={(id) => update(row.key, { variationId: id })}
                          label={`Item, row ${index + 1}`}
                          invalid={!!isDup}
                          describedBy={problem ? warnId : undefined}
                          autoFocus={index > 0 && index === rows.length - 1}
                        />
                        {problem && row.variationId !== null && (isDup || row.qty.trim() !== "") ? (
                          <div id={warnId} className={styles.warn} role="alert">
                            <Icon name="alert" size={14} />
                            {problem}
                          </div>
                        ) : index === 0 && !option ? (
                          <div className={styles.help}>Type &quot;cooker 3&quot; to find a product and variation</div>
                        ) : null}
                      </td>
                      <td className={`${shared.num} ${styles.stockCell}`}>{option ? `${option.stock} pcs` : "–"}</td>
                      <td>
                        <div className={`field ${styles.qty}`}>
                          <input
                            aria-label={`Quantity, row ${index + 1}`}
                            inputMode="numeric"
                            value={row.qty}
                            onChange={(e) => update(row.key, { qty: e.target.value })}
                          />
                          <span>pcs</span>
                        </div>
                      </td>
                      <td>
                        <div className="field">
                          <input
                            aria-label={`Remarks, row ${index + 1}`}
                            value={row.remarks}
                            onChange={(e) => update(row.key, { remarks: e.target.value })}
                            placeholder="Remarks"
                          />
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className={styles.removeButton}
                          aria-label={`Remove row ${index + 1}`}
                          onClick={() => setRows((list) => (list.length === 1 ? [newRow()] : list.filter((r) => r.key !== row.key)))}
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className={styles.rowButtons}>
            <button type="button" className={`btn ${styles.dashed}`} onClick={() => setRows((list) => [...list, newRow()])}>
              <Icon name="plus" size={16} />
              Add row
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              style={{ minHeight: 44, fontSize: 14 }}
              onClick={() => setAdding(rows.find((r) => r.variationId === null)?.key ?? -1)}
            >
              + New item
            </button>
          </div>

          {saved ? (
            <p role="status" className={shared.saved}>
              {saved}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className={shared.errorText}>
              {error}
            </p>
          ) : null}

          <div className={shared.footer}>
            <span className={shared.footerText} aria-live="polite">
              {plural(rows.length, "row")}
              {attention ? ` · ${attention} ${attention === 1 ? "needs" : "need"} attention` : ""}
            </span>
            <div className={shared.actions}>
              <button type="button" className="btn" onClick={clear}>
                Clear
              </button>
              <button type="submit" className="btn btn--primary" disabled={!canSave} aria-disabled={!canSave}>
                {saving ? "Saving…" : SAVE_LABEL[type]}
              </button>
            </div>
          </div>
        </form>

        <aside aria-labelledby="recent-h" className={`card ${styles.aside}`}>
          <div className={styles.asideHead}>
            <h2 id="recent-h">Today&apos;s entries</h2>
            <span>{today.data?.bs_text ?? ""}</span>
          </div>
          <div role="group" aria-label="Show entries for" className={styles.switch}>
            <div aria-hidden="true" className={`${styles.knob} ${isPurchaseTab ? "" : styles.knobRight}`} />
            <button type="button" aria-pressed={isPurchaseTab} onClick={() => setTab("purchase")}>
              Purchase
            </button>
            <button type="button" aria-pressed={!isPurchaseTab} onClick={() => setTab("consumption")}>
              Consumption
            </button>
          </div>
          <div className={styles.totals}>
            <div className={`${shared.tint} ${isPurchaseTab ? shared.tintIn : shared.tintOut}`}>
              <span className={shared.tintLabel}>Entries</span>
              <span className={styles.totalValue}>{entries.data?.count ?? "…"}</span>
            </div>
            <div className={`${shared.tint} ${isPurchaseTab ? shared.tintIn : shared.tintOut}`}>
              <span className={shared.tintLabel}>Total quantity</span>
              <span className={`${styles.totalValue} ${isPurchaseTab ? shared.in : shared.out}`}>
                {entries.data?.total_quantity ?? "…"} pcs
              </span>
            </div>
          </div>
          <div className={styles.list} aria-busy={entries.loading}>
            {entries.data?.entries.length === 0 ? (
              <p className={shared.hint}>No {tab} entries yet today.</p>
            ) : null}
            {entries.data?.entries.map((e) => (
              <div key={e.id} className={styles.entry}>
                <div className={styles.entryText}>
                  <span>
                    {e.product_name} · {e.variation_name}
                  </span>
                  <span className={styles.entryMeta}>
                    {e.remarks ?? (e.reference ? `Bill ${e.reference}` : "—")} · {e.entered_by} · {e.time}
                  </span>
                </div>
                <span
                  className={styles.badge}
                  style={isPurchaseTab ? { background: "var(--pill-ok-bg)", color: "var(--pill-ok-fg)" } : { background: "var(--pill-low-bg)", color: "var(--pill-low-fg)" }}
                >
                  {isPurchaseTab ? "+" : "−"}
                  {e.quantity}
                </span>
              </div>
            ))}
          </div>
          <Link href="/stock/report" style={{ fontSize: 14 }}>
            Full stock report
          </Link>
        </aside>
      </div>

      <AddProductModal
        open={adding !== null}
        onClose={() => setAdding(null)}
        existing={products.data?.products ?? []}
        todayBs={today.data?.bs ?? ""}
        onSaved={(product) => {
          const first = product.variations[0];
          if (first && adding !== null && adding >= 0) update(adding, { variationId: first.id });
          setVersion((n) => n + 1);
        }}
      />
    </>
  );
}
