"use client";

import { useSearchParams } from "next/navigation";
import * as api from "./api";
import { STATUS_LABEL } from "./helpers";
import { PrintSheet } from "./PrintSheet";
import { useAsync } from "./useAsync";
import styles from "./print.module.css";

/** /stock/shopping-list/print?auto=1 — items at or below reorder level, with an order column to fill in. */
export function ShoppingListPrint() {
  const params = useSearchParams();
  const auto = params.get("auto") === "1";
  const low = useAsync(() => api.getLowStock(), "low");
  const today = useAsync(() => api.getToday(), "today");
  const rows = low.data?.rows ?? [];
  return (
    <PrintSheet
      title="Shopping list"
      subtitle="Variations at or below their reorder level · out of stock first"
      today={today.data}
      auto={auto}
      ready={!!low.data && !!today.data}
      legend="Suggested = short by + reorder level, so the shelf lands at twice the reorder level. Quantities in pcs."
    >
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Status</th>
            <th scope="col" className={styles.num}>
              In stock
            </th>
            <th scope="col" className={styles.num}>
              Reorder at
            </th>
            <th scope="col" className={styles.num}>
              Short by
            </th>
            <th scope="col" className={styles.num}>
              Suggested
            </th>
            <th scope="col">Last purchased</th>
            <th scope="col" className={styles.num}>
              Ordered
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.variation_id}>
              <td>
                {r.product_name} · {r.variation_name}
              </td>
              <td>
                <span className={`${styles.status} ${r.status === "out" ? styles.statusOut : styles.statusLow}`}>
                  {r.status === "out" ? "Out of stock" : STATUS_LABEL[r.status]}
                </span>
              </td>
              <td className={styles.num}>{r.in_stock}</td>
              <td className={styles.num}>{r.reorder_level}</td>
              <td className={styles.num}>{r.short_by}</td>
              <td className={styles.num}>
                <strong>{r.short_by + r.reorder_level}</strong>
              </td>
              <td>{r.last_purchase_bs ? `${r.last_purchase_bs} · ${r.last_purchase_qty} pcs` : "—"}</td>
              <td className={styles.num}>______</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8}>Nothing to order: every variation is above its reorder level.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <div className={styles.signatures}>
        <div>Prepared by</div>
        <div>Approved by</div>
        <div>Date</div>
      </div>
    </PrintSheet>
  );
}
