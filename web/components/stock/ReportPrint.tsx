"use client";

import { useSearchParams } from "next/navigation";
import * as api from "./api";
import { formatBsLong, parseBsIso } from "./calendar";
import { MOVEMENT_LABEL } from "./helpers";
import { PrintSheet } from "./PrintSheet";
import { reportFormFromParams, toFilter } from "./reportParams";
import { useAsync } from "./useAsync";
import styles from "./print.module.css";

/** /stock/report/print?from=&to=&product=&variation=&type=&ad=1&auto=1 — the whole range on A4. */
export function ReportPrint() {
  const params = useSearchParams();
  const today = useAsync(() => api.getToday(), "today");
  const form = today.data
    ? reportFormFromParams((k) => params.get(k), {
        from_bs: today.data.bs,
        to_bs: today.data.bs,
        product_id: null,
        variation_id: null,
        type: null,
        show_ad: true,
      })
    : null;
  const key = form ? JSON.stringify(form) : "";
  const report = useAsync(() => (form ? api.getReport(toFilter(form, 1, 100000)) : Promise.reject(new Error("no filter"))), key);
  const products = useAsync(() => api.listProducts(), "products");
  const auto = params.get("auto") === "1";
  const ready = !!report.data && !!today.data;
  const from = form ? parseBsIso(form.from_bs) : null;
  const to = form ? parseBsIso(form.to_bs) : null;
  const product = products.data?.products.find((p) => p.id === form?.product_id);
  const variation = product?.variations.find((v) => v.id === form?.variation_id);
  const scope = [product?.name, variation?.name, form?.type ? MOVEMENT_LABEL[form.type] : null].filter(Boolean).join(" · ");

  return (
    <PrintSheet
      title="Stock report"
      subtitle={`${from ? formatBsLong(from) : ""} – ${to ? formatBsLong(to) : ""} BS${scope ? ` · ${scope}` : " · all products"}`}
      today={today.data}
      auto={auto}
      ready={ready}
      wide
      legend="Totals cover every entry type in the range; the list follows the chosen type filter. Quantities in pcs."
    >
      {report.data ? (
        <div className={styles.summary}>
          <div>
            <span>Stock at start</span>
            <span>{report.data.totals.stock_at_start}</span>
          </div>
          <div>
            <span>Purchased</span>
            <span>+{report.data.totals.purchased}</span>
          </div>
          {report.data.totals.opening ? (
            <div>
              <span>Opening in range</span>
              <span>+{report.data.totals.opening}</span>
            </div>
          ) : null}
          <div>
            <span>Consumed</span>
            <span>−{report.data.totals.consumed}</span>
          </div>
          <div>
            <span>Stock at end</span>
            <span>{report.data.totals.stock_at_end}</span>
          </div>
          <div>
            <span>Entries</span>
            <span>{report.data.total}</span>
          </div>
        </div>
      ) : null}
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Date (BS)</th>
            {form?.show_ad ? <th scope="col">Date (AD)</th> : null}
            <th scope="col">Product</th>
            <th scope="col">Variation</th>
            <th scope="col" className={styles.num}>
              Quantity
            </th>
            <th scope="col">Type</th>
            <th scope="col">Remarks</th>
            <th scope="col">Entered by</th>
          </tr>
        </thead>
        <tbody>
          {report.data?.rows.map((m) => (
            <tr key={m.id}>
              <td>{m.date_bs}</td>
              {form?.show_ad ? <td>{m.date_ad}</td> : null}
              <td>{m.product_name}</td>
              <td>{m.variation_name}</td>
              <td className={styles.num}>{m.quantity}</td>
              <td>{MOVEMENT_LABEL[m.type]}</td>
              <td>{m.remarks ?? ""}</td>
              <td>{m.entered_by}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </PrintSheet>
  );
}
