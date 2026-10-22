"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import * as api from "./api";
import { filterProducts, STATUS_LABEL } from "./helpers";
import { PrintSheet } from "./PrintSheet";
import { useAsync } from "./useAsync";
import type { StockStatus } from "./types";
import styles from "./print.module.css";

const STATUS_CLASS: Record<StockStatus, string> = {
  ok: styles.statusOk,
  low: styles.statusLow,
  out: styles.statusOut,
};

/** /stock/items/print?q=&codes=1&auto=1 — the A4 stock list with signature lines. */
export function ItemsPrint() {
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const showCodes = params.get("codes") !== "0";
  const auto = params.get("auto") === "1";
  const products = useAsync(() => api.listProducts(), "products");
  const today = useAsync(() => api.getToday(), "today");
  const list = useMemo(() => filterProducts(products.data?.products ?? [], q), [products.data, q]);
  const variations = list.flatMap((p) => p.variations);
  const ready = !!products.data && !!today.data;

  const totals = {
    products: list.length,
    variations: variations.length,
    pcs: variations.reduce((a, v) => a + v.in_stock, 0),
    todayIn: variations.reduce((a, v) => a + v.in_today, 0),
    todayOut: variations.reduce((a, v) => a + v.out_today, 0),
    low: variations.filter((v) => v.status === "low").length,
    out: variations.filter((v) => v.status === "out").length,
  };

  return (
    <PrintSheet
      title="Stock list"
      subtitle={q.trim() ? `Items matching "${q.trim()}"` : "All products and variations"}
      today={today.data}
      auto={auto}
      ready={ready}
      legend="Status: OK above the reorder level · Low at or below it · Out at 0. Quantities in pcs."
    >
      <div className={styles.summary}>
        <div>
          <span>Products</span>
          <span>{totals.products}</span>
        </div>
        <div>
          <span>Variations</span>
          <span>{totals.variations}</span>
        </div>
        <div>
          <span>Total pcs</span>
          <span>{totals.pcs}</span>
        </div>
        <div>
          <span>Today in</span>
          <span>+{totals.todayIn}</span>
        </div>
        <div>
          <span>Today out</span>
          <span>−{totals.todayOut}</span>
        </div>
        <div>
          <span>Low / Out</span>
          <span>
            {totals.low} / {totals.out}
          </span>
        </div>
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Variation</th>
            {showCodes ? <th scope="col">Code</th> : null}
            <th scope="col" className={styles.num}>
              In today
            </th>
            <th scope="col" className={styles.num}>
              Out today
            </th>
            <th scope="col" className={styles.num}>
              In stock
            </th>
            <th scope="col" className={styles.num}>
              Reorder
            </th>
            <th scope="col">Status</th>
            <th scope="col" className={styles.num}>
              Counted
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((p) => (
            <ProductRows key={p.id} name={p.name} by={p.variations_by} showCodes={showCodes}>
              {p.variations.map((v) => (
                <tr key={v.id}>
                  <td>{v.name}</td>
                  {showCodes ? <td className={styles.code}>{v.code}</td> : null}
                  <td className={styles.num}>{v.in_today ? `+${v.in_today}` : ""}</td>
                  <td className={styles.num}>{v.out_today ? `−${v.out_today}` : ""}</td>
                  <td className={styles.num}>
                    <strong>{v.in_stock}</strong>
                  </td>
                  <td className={styles.num}>{v.reorder_level}</td>
                  <td>
                    <span className={`${styles.status} ${STATUS_CLASS[v.status]}`}>{STATUS_LABEL[v.status]}</span>
                  </td>
                  <td className={styles.num}>______</td>
                </tr>
              ))}
            </ProductRows>
          ))}
        </tbody>
      </table>
      <div className={styles.signatures}>
        <div>Counted by</div>
        <div>Checked by</div>
        <div>Date</div>
      </div>
    </PrintSheet>
  );
}

function ProductRows({
  name,
  by,
  showCodes,
  children,
}: {
  name: string;
  by: string;
  showCodes: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr className={styles.groupRow}>
        <td colSpan={showCodes ? 8 : 7}>
          {name} <span className={styles.code}>· by {by.toLowerCase()}</span>
        </td>
      </tr>
      {children}
    </>
  );
}
