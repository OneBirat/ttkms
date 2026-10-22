"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { Segmented } from "@/components/ui/Segmented";
import { AddProductModal } from "./AddProductModal";
import { AddVariationModal, EditVariationModal } from "./EditModals";
import * as api from "./api";
import { filterProducts, lowCount, plural, productTotal, signed, STATUS_LABEL } from "./helpers";
import { useAsync } from "./useAsync";
import type { Product, Variation } from "./types";
import shared from "./stock.module.css";
import styles from "./items.module.css";

type View = "compact" | "grouped";

const VIEWS: { value: View; label: string }[] = [
  { value: "compact", label: "Compact" },
  { value: "grouped", label: "Grouped" },
];

export function ItemsPage() {
  const products = useAsync(() => api.listProducts(), "products");
  const today = useAsync(() => api.getToday(), "today");
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("compact");
  const [showCodes, setShowCodes] = useState(true);
  const [open, setOpen] = useState<Record<number, boolean> | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ product: Product; variation: Variation } | null>(null);
  const [addingTo, setAddingTo] = useState<Product | null>(null);

  const all = useMemo(() => products.data?.products ?? [], [products.data]);
  const list = useMemo(() => filterProducts(all, q), [all, q]);
  const searching = q.trim().length > 0;
  // The first product starts expanded, as in the design.
  const openMap = open ?? (all.length ? { [all[0].id]: true } : {});
  const isOpen = (p: Product) => searching || !!openMap[p.id];
  const anyClosed = list.some((p) => !isOpen(p));
  const variationCount = list.reduce((a, p) => a + p.variations.length, 0);
  const summary = products.data?.summary;
  const todayBs = today.data?.bs ?? "";
  const printHref = `/stock/items/print?q=${encodeURIComponent(q)}&codes=${showCodes ? 1 : 0}`;

  const header = (
    <PageHeader
      title="Items"
      subtitle="Each product has its own variations, and stock is counted per variation. Click a product to see its calendar and sales patterns."
      actions={
        <button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>
          <Icon name="plus" size={16} />
          Add product
        </button>
      }
    />
  );

  if (products.error) {
    return (
      <>
        {header}
        <EmptyState icon="alert" title="Could not load items" text={products.error}>
          <button type="button" className="btn" onClick={products.reload}>
            Try again
          </button>
        </EmptyState>
      </>
    );
  }

  const variationRow = (p: Product, v: Variation, index: number, grouped: boolean) => (
    <tr key={v.id} className={!grouped && index === 0 ? styles.firstRow : undefined}>
      {grouped ? (
        <td className={`${styles.indent} ${styles.variationName}`}>{v.name}</td>
      ) : (
        <>
          <td className={index === 0 ? styles.productCell : undefined}>
            {index === 0 ? <Link href={`/stock/products/${p.id}`}>{p.name}</Link> : null}
          </td>
          <td>{v.name}</td>
        </>
      )}
      {showCodes ? <td className={shared.code}>{v.code}</td> : null}
      <td className={`${shared.num} ${v.in_today ? shared.in : shared.dim}`}>{signed(v.in_today, "+")}</td>
      <td className={`${shared.num} ${v.out_today ? shared.out : shared.dim}`}>{signed(v.out_today, "−")}</td>
      <td className={`${shared.num} ${shared.strong}`}>{v.in_stock}</td>
      <td className={`${shared.num} ${shared.status}`}>{v.reorder_level}</td>
      <td>
        <Pill status={v.status} label={STATUS_LABEL[v.status]} className={grouped ? undefined : shared.smallPill} />
      </td>
      <td style={{ textAlign: "right" }}>
        <button
          type="button"
          className={`btn btn--ghost ${grouped ? "" : styles.editButton}`}
          onClick={() => setEditing({ product: p, variation: v })}
          aria-label={`Edit ${p.name} ${v.name}`}
        >
          Edit
        </button>
      </td>
    </tr>
  );

  return (
    <>
      {header}
      <section aria-label="Products" className={`card ${shared.panel}`}>
        <div className={shared.toolbar}>
          <div className={`field ${shared.search}`}>
            <Icon name="search" size={16} />
            <input
              type="search"
              aria-label="Search products or variations"
              placeholder="Search product or variation, e.g. cooker 3"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Segmented options={VIEWS} value={view} onChange={setView} label="View" />
          <label className={shared.check}>
            <input type="checkbox" checked={showCodes} onChange={(e) => setShowCodes(e.target.checked)} />
            Show codes
          </label>
          <a
            href={`${printHref}&auto=1`}
            target="_blank"
            rel="noopener"
            className="btn"
            title="Download a printable A4 PDF of this list (follows search and Show codes)"
          >
            <Icon name="download" size={16} />
            PDF
          </a>
          <a href={printHref} target="_blank" rel="noopener" className="btn" title="Print this list">
            <Icon name="print" size={16} />
            Print
          </a>
          {view === "grouped" ? (
            <button
              type="button"
              className="btn btn--ghost"
              style={{ minHeight: 44 }}
              onClick={() => {
                const next: Record<number, boolean> = {};
                list.forEach((p) => {
                  next[p.id] = anyClosed;
                });
                setOpen({ ...openMap, ...next });
              }}
            >
              {anyClosed ? "Expand all" : "Collapse all"}
            </button>
          ) : null}
        </div>

        <div className={shared.toolbar}>
          <span className={shared.summary} role="status">
            {products.loading
              ? "Loading…"
              : `${plural(list.length, "product")} · ${variationCount} variations tracked${searching ? ` · matching "${q.trim()}"` : ""}`}
          </span>
          <span className={`${shared.chip} ${shared.chipIn}`}>
            <strong>Today in</strong>
            <span className={shared.mono}>+{summary?.today_in ?? 0} pcs</span>
          </span>
          <span className={`${shared.chip} ${shared.chipOut}`}>
            <strong>Today out</strong>
            <span className={shared.mono}>−{summary?.today_out ?? 0} pcs</span>
          </span>
        </div>

        {view === "compact" ? (
          <div className={shared.tableWrap}>
            <table className={shared.ct}>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Variation</th>
                  {showCodes ? <th scope="col">Code</th> : null}
                  <th scope="col" className={shared.num} title="Purchased or produced today">
                    In today
                  </th>
                  <th scope="col" className={shared.num} title="Sold or used today">
                    Out today
                  </th>
                  <th scope="col" className={shared.num}>
                    In stock
                  </th>
                  <th scope="col" className={shared.num}>
                    Reorder
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.length === 0 ? (
                  <tr>
                    <td colSpan={showCodes ? 9 : 8} className={shared.status} style={{ textAlign: "center", padding: 24 }}>
                      {products.loading ? "Loading…" : "No products match."}
                    </td>
                  </tr>
                ) : (
                  list.map((p) => p.variations.map((v, i) => variationRow(p, v, i, false)))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={styles.groups}>
            {list.map((p) => {
              const low = lowCount(p.variations);
              const expanded = isOpen(p);
              return (
                <div key={p.id} className={styles.group}>
                  <button
                    type="button"
                    className={styles.groupHead}
                    aria-expanded={expanded}
                    onClick={() => setOpen({ ...openMap, [p.id]: !openMap[p.id] })}
                  >
                    <Icon name="chevron-right" size={16} className={styles.chevron} />
                    <span className={styles.groupTitle}>
                      <span className={styles.groupName}>{p.name}</span>
                      <span className={styles.groupMeta}>
                        variations by {p.variations_by.toLowerCase()}: {p.variations.map((v) => v.name).join(", ")}
                      </span>
                    </span>
                    <span className={styles.groupCount}>{plural(p.variations.length, "variation")}</span>
                    <span className={styles.groupTotal}>{productTotal(p)} pcs</span>
                    {low > 0 ? (
                      <Pill status="low" label={`${plural(low, "variation")} low`} />
                    ) : (
                      <Pill status="ok" label="OK" />
                    )}
                  </button>
                  {expanded ? (
                    <div className={styles.groupBody}>
                      <table className={shared.tbl}>
                        <thead>
                          <tr>
                            <th scope="col" className={styles.indent}>
                              {p.variations_by}
                            </th>
                            {showCodes ? <th scope="col">Code</th> : null}
                            <th scope="col" className={shared.num}>
                              In today
                            </th>
                            <th scope="col" className={shared.num}>
                              Out today
                            </th>
                            <th scope="col" className={shared.num}>
                              In stock
                            </th>
                            <th scope="col" className={shared.num}>
                              Reorder at
                            </th>
                            <th scope="col">Status</th>
                            <th scope="col">
                              <span className="sr-only">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.variations.map((v, i) => variationRow(p, v, i, true))}
                          <tr>
                            <td colSpan={showCodes ? 8 : 7} className={styles.groupFoot}>
                              <button type="button" className="btn btn--ghost" onClick={() => setAddingTo(p)}>
                                + Add variation to {p.name}
                              </button>
                              <Link href={`/stock/products/${p.id}`}>View sales &amp; purchase history</Link>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {!products.loading && list.length === 0 ? <p className={`${shared.status} ${shared.toolbar}`}>No products match.</p> : null}
          </div>
        )}
      </section>

      <AddProductModal
        open={adding}
        onClose={() => setAdding(false)}
        existing={all}
        todayBs={todayBs}
        onSaved={(product) => {
          setOpen({ ...openMap, [product.id]: true });
          products.reload();
        }}
      />
      <EditVariationModal
        variation={editing?.variation ?? null}
        product={editing?.product ?? null}
        onClose={() => setEditing(null)}
        onSaved={() => products.reload()}
      />
      <AddVariationModal
        product={addingTo}
        todayBs={todayBs}
        onClose={() => setAddingTo(null)}
        onSaved={() => products.reload()}
      />
    </>
  );
}
