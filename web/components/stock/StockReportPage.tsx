"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BsDateInput } from "@/components/ui/BsDateInput";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { Pill } from "@/components/ui/Pill";
import * as api from "./api";
import { parseBsIso, formatBsIso } from "./calendar";
import { downloadCsv } from "./csv";
import { MOVEMENT_LABEL, movementPillStatus } from "./helpers";
import { PAGE_SIZE, reportQuery, toFilter, type ReportForm } from "./reportParams";
import { useAsync } from "./useAsync";
import type { MovementType } from "./types";
import shared from "./stock.module.css";
import styles from "./report.module.css";

const TYPE_OPTIONS: { value: MovementType | ""; label: string }[] = [
  { value: "", label: "All types" },
  { value: "purchase", label: "Purchase" },
  { value: "consumption", label: "Consumption" },
  { value: "opening", label: "Opening" },
];

export function StockReportPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const today = useAsync(() => api.getToday(), "today");
  const products = useAsync(() => api.listProducts(), "products");
  const [form, setForm] = useState<ReportForm | null>(null);
  const [applied, setApplied] = useState<ReportForm | null>(null);

  // Defaults: first day of this BS month to today.
  useEffect(() => {
    if (!today.data || form) return;
    const bs = parseBsIso(today.data.bs);
    const defaults: ReportForm = {
      from_bs: bs ? formatBsIso({ ...bs, day: 1 }) : today.data.bs,
      to_bs: today.data.bs,
      product_id: null,
      variation_id: null,
      type: null,
      show_ad: true,
    };
    setForm(defaults);
    setApplied(defaults);
  }, [today.data, form]);

  const reportKey = applied ? `${reportQuery(applied)}&page=${page}` : "";
  const report = useAsync(
    () => (applied ? api.getReport(toFilter(applied, page)) : Promise.reject(new Error("no filter"))),
    reportKey,
  );

  const product = products.data?.products.find((p) => p.id === form?.product_id) ?? null;
  const variations = useMemo(() => product?.variations ?? [], [product]);

  const apply = (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setApplied(form);
    if (page !== 1) router.replace(pathname);
  };

  const exportCsv = async () => {
    if (!applied) return;
    const all = await api.getReport(toFilter(applied, 1, 100000));
    downloadCsv(
      `stock-report ${applied.from_bs} to ${applied.to_bs}`,
      ["Date (BS)", "Date (AD)", "Product", "Variation", "Quantity (pcs)", "Type", "Remarks", "Entered by"],
      all.rows.map((m) => [m.date_bs, m.date_ad, m.product_name, m.variation_name, m.quantity, MOVEMENT_LABEL[m.type], m.remarks, m.entered_by]),
    );
  };

  const printHref = applied ? `/stock/report/print?${reportQuery(applied)}` : "#";
  const showAd = applied?.show_ad ?? true;
  const rows = report.data?.rows ?? [];
  const total = report.data?.total ?? 0;
  const first = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const last = Math.min(page * PAGE_SIZE, total);

  return (
    <>
      <PageHeader
        title="Stock report"
        subtitle="Stock at start, in, out and balance for any date range, with every opening, purchase and consumption entry below."
        actions={
          <>
            <button type="button" className="btn" onClick={() => void exportCsv()} disabled={!applied}>
              Excel
            </button>
            <a href={`${printHref}&auto=1`} target="_blank" rel="noopener" className="btn" aria-disabled={!applied}>
              PDF
            </a>
            <a href={printHref} target="_blank" rel="noopener" className="btn" aria-disabled={!applied}>
              Print
            </a>
          </>
        }
      />

      <form role="search" aria-label="Filter stock report" className={`card ${styles.filters}`} onSubmit={apply}>
        <div className={styles.filter}>
          <BsDateInput name="from_bs" label="From (BS)" id="rep-from" value={form?.from_bs ?? ""} onChange={(v) => form && setForm({ ...form, from_bs: v })} />
        </div>
        <div className={styles.filter}>
          <BsDateInput name="to_bs" label="To (BS)" id="rep-to" value={form?.to_bs ?? ""} onChange={(v) => form && setForm({ ...form, to_bs: v })} />
        </div>
        <div className={`${styles.filter} ${styles.filterWide}`}>
          <label htmlFor="rep-product" className={shared.fieldLabel}>
            Product
          </label>
          <div className="field">
            <select
              id="rep-product"
              value={form?.product_id ?? ""}
              onChange={(e) => form && setForm({ ...form, product_id: Number(e.target.value) || null, variation_id: null })}
            >
              <option value="">All products</option>
              {products.data?.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className={styles.filter} style={{ flexBasis: 140 }}>
          <label htmlFor="rep-variation" className={shared.fieldLabel}>
            Variation
          </label>
          <div className="field">
            <select
              id="rep-variation"
              value={form?.variation_id ?? ""}
              disabled={!product}
              onChange={(e) => form && setForm({ ...form, variation_id: Number(e.target.value) || null })}
            >
              <option value="">All variations</option>
              {variations.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className={styles.filter}>
          <label htmlFor="rep-type" className={shared.fieldLabel}>
            Type
          </label>
          <div className="field">
            <select id="rep-type" value={form?.type ?? ""} onChange={(e) => form && setForm({ ...form, type: (e.target.value || null) as MovementType | null })}>
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className={shared.check}>
          <input type="checkbox" checked={form?.show_ad ?? true} onChange={(e) => form && setForm({ ...form, show_ad: e.target.checked })} />
          Show AD date
        </label>
        <button type="submit" className="btn btn--primary" disabled={!form}>
          Apply
        </button>
      </form>

      {report.error ? (
        <EmptyState icon="alert" title="Could not load the report" text={report.error}>
          <button type="button" className="btn" onClick={report.reload}>
            Try again
          </button>
        </EmptyState>
      ) : (
        <>
          <section aria-label="Totals for this filter" className={styles.totals} aria-busy={report.loading}>
            <div className={`card ${shared.kpi}`}>
              <span className={shared.kpiLabel}>Stock at start</span>
              <span className={shared.kpiValue} style={{ fontSize: 22 }}>
                {report.data?.totals.stock_at_start ?? "…"}
              </span>
            </div>
            <div className={`card ${shared.kpi}`}>
              <span className={shared.kpiLabel}>Purchased</span>
              <span className={`${shared.kpiValue} ${shared.in}`} style={{ fontSize: 22 }}>
                +{report.data?.totals.purchased ?? "…"}
              </span>
              {report.data?.totals.opening ? <span className={shared.kpiNote}>+ {report.data.totals.opening} pcs opening in range</span> : null}
            </div>
            <div className={`card ${shared.kpi}`}>
              <span className={shared.kpiLabel}>Consumed</span>
              <span className={`${shared.kpiValue} ${shared.out}`} style={{ fontSize: 22 }}>
                −{report.data?.totals.consumed ?? "…"}
              </span>
            </div>
            <div className={`card ${shared.kpi}`}>
              <span className={shared.kpiLabel}>Stock at end</span>
              <span className={shared.kpiValue} style={{ fontSize: 22 }}>
                {report.data?.totals.stock_at_end ?? "…"}
              </span>
            </div>
          </section>

          <section aria-label="Movements" className={`card ${styles.table}`} aria-busy={report.loading}>
            <div style={{ overflowX: "auto" }}>
              <table className={shared.tbl}>
                <thead>
                  <tr>
                    <th scope="col">Date (BS)</th>
                    {showAd ? <th scope="col">Date (AD)</th> : null}
                    <th scope="col">Product</th>
                    <th scope="col">Variation</th>
                    <th scope="col" className={shared.num}>
                      Quantity
                    </th>
                    <th scope="col">Type</th>
                    <th scope="col">Remarks</th>
                    <th scope="col">Entered by</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={showAd ? 8 : 7} className={shared.status} style={{ textAlign: "center", padding: 24 }}>
                        {report.loading || !applied ? "Loading…" : "No entries in this range."}
                      </td>
                    </tr>
                  ) : (
                    rows.map((m) => (
                      <tr key={m.id}>
                        <td className={shared.mono}>{m.date_bs}</td>
                        {showAd ? <td className={`${shared.mono} ${styles.ad}`}>{m.date_ad}</td> : null}
                        <td>{m.product_name}</td>
                        <td>{m.variation_name}</td>
                        <td className={shared.num}>{m.quantity} pcs</td>
                        <td>
                          <Pill status={movementPillStatus(m.type)} label={MOVEMENT_LABEL[m.type]} />
                        </td>
                        <td>{m.remarks ?? "—"}</td>
                        <td>{m.entered_by}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className={styles.pager}>
              <Pagination
                page={page}
                pages={report.data?.pages ?? 1}
                hrefFor={(n) => (n === 1 ? pathname : `${pathname}?page=${n}`)}
                summary={total ? `Showing ${first}–${last} of ${total} entries` : "No entries"}
              />
            </div>
          </section>
        </>
      )}
    </>
  );
}
