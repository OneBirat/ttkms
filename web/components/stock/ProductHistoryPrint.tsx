"use client";

import { useSearchParams } from "next/navigation";
import * as api from "./api";
import { SATURDAY, WEEKDAY_INITIALS_NP, formatAdShort } from "./calendar";
import { fixed1, isMonthBoundary } from "./helpers";
import { PrintSheet } from "./PrintSheet";
import { useAsync } from "./useAsync";
import styles from "./print.module.css";

/** /stock/products/[id]/print?variation=&days=30&mode=both&auto=1 — daily history as A4. */
export function ProductHistoryPrint({ id }: { id: number }) {
  const params = useSearchParams();
  const variationId = params.get("variation") ? Number(params.get("variation")) : null;
  const days = Number(params.get("days") ?? 30) || 30;
  const mode = params.get("mode") ?? "both";
  const auto = params.get("auto") === "1";
  const product = useAsync(() => api.getProduct(id), `product:${id}`);
  const today = useAsync(() => api.getToday(), "today");
  const history = useAsync(() => api.getDailyHistory(id, variationId, days), `${id}:${variationId}:${days}`);
  const ready = !!product.data && !!today.data && !!history.data;
  const variation = product.data?.variations.find((v) => v.id === variationId) ?? null;
  const rows = history.data?.rows ?? [];

  return (
    <PrintSheet
      title={`${product.data?.name ?? ""}${variation ? ` · ${variation.name}` : " · all variations"}`}
      subtitle={`Daily history · last ${days} days`}
      today={today.data}
      auto={auto}
      ready={ready}
      legend="Newest first · Saturdays (closed) greyed · line = BS month boundary · pcs"
    >
      {history.data ? (
        <div className={styles.summary}>
          <div>
            <span>Purchased</span>
            <span>+{history.data.purchased}</span>
          </div>
          <div>
            <span>Sold / used</span>
            <span>−{history.data.sold}</span>
          </div>
          <div>
            <span>Avg sold per open day</span>
            <span>{fixed1(history.data.avg_sold_per_open_day)}</span>
          </div>
          <div>
            <span>Days with sales</span>
            <span>
              {history.data.days_with_sales} / {history.data.open_days}
            </span>
          </div>
        </div>
      ) : null}
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Date (BS)</th>
            <th scope="col">Day</th>
            <th scope="col">Date (AD)</th>
            {mode !== "out" ? (
              <th scope="col" className={styles.num}>
                Purchased
              </th>
            ) : null}
            {mode !== "in" ? (
              <th scope="col" className={styles.num}>
                Sold / used
              </th>
            ) : null}
            <th scope="col" className={styles.num}>
              Closing stock
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.date_ad} className={`${r.weekday === SATURDAY ? styles.sat : ""} ${isMonthBoundary(rows, i) ? styles.monthLine : ""}`}>
              <td className={styles.num} style={{ textAlign: "left" }}>
                {r.date_bs}
              </td>
              <td lang="ne" className={styles.np}>
                {WEEKDAY_INITIALS_NP[r.weekday]}
              </td>
              <td>{formatAdShort(r.date_ad)}</td>
              {mode !== "out" ? <td className={styles.num}>{r.purchased ? `+${r.purchased}` : ""}</td> : null}
              {mode !== "in" ? <td className={styles.num}>{r.sold ? `−${r.sold}` : ""}</td> : null}
              <td className={styles.num}>{r.closing}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </PrintSheet>
  );
}
