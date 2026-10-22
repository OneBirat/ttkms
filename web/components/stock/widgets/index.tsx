"use client";

import { Suspense, useState, type ReactElement } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons";
import { Pagination } from "@/components/ui/Pagination";
import { Pill } from "@/components/ui/Pill";
import { StatCard } from "@/components/ui/StatCard";
import type { Widget } from "@/lib/api";
import * as api from "../api";
import { downloadCsv } from "../csv";
import { plural, STATUS_LABEL } from "../helpers";
import { useAsync } from "../useAsync";
import type { CurrentStockData, LowStockData, StockStatsData } from "../types";
import shared from "../stock.module.css";
import styles from "./widgets.module.css";

export type StockWidgetComponent = (props: { widget: Widget }) => ReactElement;

/** True when the dashboard endpoint already filled the widget's data. */
function filled<T extends object>(data: Record<string, unknown>): T | null {
  return Object.keys(data).length > 0 ? (data as T) : null;
}

// ------------------------------------------------------------ stock_stats

/** Stat cards + page actions ("Record purchase" / "Record consumption"). */
export function StockStatsWidget({ widget }: { widget: Widget }) {
  const given = filled<StockStatsData>(widget.data);
  const loaded = useAsync(() => (given ? Promise.resolve(given) : api.getStockStats()), "stock_stats");
  const s = given ?? loaded.data;
  return (
    <section aria-label={widget.title} className={styles.stats}>
      <div className={styles.actions}>
        <Link href="/stock/entry?type=consumption" className="btn">
          Record consumption
        </Link>
        <Link href="/stock/entry?type=purchase" className="btn btn--primary">
          <Icon name="plus" size={16} />
          Record purchase
        </Link>
      </div>
      <div className={styles.cards}>
        <StatCard label="Variations tracked" value={s?.variations ?? 0} hint={s ? `across ${plural(s.products, "product")}` : "…"} />
        <StatCard label="Below reorder level" value={s?.below_reorder ?? 0} tone="low" href="#low" hint="See items" />
        <StatCard
          label="Entries today"
          value={s?.entries_today ?? 0}
          hint={s ? `${s.purchases_today} purchase · ${s.consumptions_today} consumption` : "…"}
        />
      </div>
    </section>
  );
}

// -------------------------------------------------------------- stock_low

export function LowStockWidget({ widget }: { widget: Widget }) {
  const given = filled<LowStockData>(widget.data);
  const loaded = useAsync(() => (given ? Promise.resolve(given) : api.getLowStock()), "stock_low");
  const rows = (given ?? loaded.data)?.rows ?? [];
  return (
    <section id="low" aria-labelledby="low-h" className={`card ${styles.widget}`}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h2 id="low-h" className={styles.title}>
            {widget.title || "Low in stock"}
          </h2>
          <span className={styles.sub}>
            {loaded.loading && !given ? "Loading…" : `${plural(rows.length, "item")} at or below their reorder level · out of stock first`}
          </span>
        </div>
        <div className={styles.headActions}>
          <Link href="/stock/items">Set reorder levels</Link>
          <a href="/stock/shopping-list/print?auto=1" target="_blank" rel="noopener" className="btn btn--sm">
            Print shopping list
          </a>
        </div>
      </div>
      <div className={styles.scroll}>
        <table className={shared.tbl}>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Status</th>
              <th scope="col" className={shared.num}>
                In stock
              </th>
              <th scope="col" className={shared.num}>
                Reorder at
              </th>
              <th scope="col" className={shared.num}>
                Short by
              </th>
              <th scope="col" className={shared.num}>
                Days left
              </th>
              <th scope="col">Last purchased</th>
              <th scope="col">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loaded.loading ? (
              <tr>
                <td colSpan={8} className={shared.status} style={{ textAlign: "center", padding: 20 }}>
                  Every variation is above its reorder level.
                </td>
              </tr>
            ) : null}
            {rows.map((r) => (
              <tr key={r.variation_id}>
                <td className={styles.item}>
                  <Link href={`/stock/products/${r.product_id}`} style={{ color: "inherit", textDecoration: "none" }}>
                    {r.product_name} · {r.variation_name}
                  </Link>
                </td>
                <td>
                  <Pill status={r.status} label={r.status === "out" ? "Out of stock" : STATUS_LABEL[r.status]} />
                </td>
                <td className={`${shared.num} ${shared.strong}`}>
                  {r.in_stock} <span className={styles.pcs}>pcs</span>
                </td>
                <td className={shared.num}>{r.reorder_level}</td>
                <td className={shared.num}>{r.short_by}</td>
                <td className={shared.num}>{r.in_stock === 0 ? 0 : r.days_left === null ? "—" : `~${r.days_left}`}</td>
                <td>{r.last_purchase_bs ? `${r.last_purchase_bs} · ${r.last_purchase_qty} pcs` : "—"}</td>
                <td>
                  <Link href={`/stock/entry?type=purchase&item=${r.variation_id}`} className={styles.rowLink}>
                    Record purchase
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className={styles.foot}>Days left = in stock ÷ average daily consumption over the last 30 days.</span>
    </section>
  );
}

// ---------------------------------------------------------- stock_current

const PAGE_SIZE = 10;

function CurrentStockTable({ widget }: { widget: Widget }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const page = Math.max(1, Number(params.get("stock_page")) || 1);
  const [q, setQ] = useState("");
  const given = filled<CurrentStockData>(widget.data);
  const loaded = useAsync(
    () => (given && !q && page === given.page ? Promise.resolve(given) : api.getCurrentStock(q, page, PAGE_SIZE)),
    `stock_current:${q}:${page}`,
  );
  const data = loaded.data;
  const rows = data?.rows ?? [];

  const exportCsv = async () => {
    const all = await api.getCurrentStock(q, 1, 100000);
    downloadCsv(
      "current-stock",
      ["Product", "Variation", "Opening", "Purchased", "Consumed", "In stock", "Status"],
      all.rows.map((r) => [r.product_name, r.variation_name, r.opening, r.purchased, r.consumed, r.in_stock, STATUS_LABEL[r.status]]),
    );
  };

  return (
    <section aria-labelledby="stock-h" className={`card ${styles.widget}`}>
      <div className={styles.head}>
        <h2 id="stock-h" className={styles.title}>
          {widget.title || "Current stock"}
        </h2>
        <div className={styles.headActions}>
          <label className={`field ${styles.search}`}>
            <Icon name="search" size={16} />
            <span className="sr-only">Search items</span>
            <input type="search" placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <button type="button" className="btn btn--sm" onClick={() => void exportCsv()}>
            Excel
          </button>
          <a href={`/stock/items/print?q=${encodeURIComponent(q)}&auto=1`} target="_blank" rel="noopener" className="btn btn--sm">
            PDF
          </a>
        </div>
      </div>
      <div className={styles.scroll} aria-busy={loaded.loading}>
        <table className={shared.tbl}>
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Variation</th>
              <th scope="col" className={shared.num}>
                Opening
              </th>
              <th scope="col" className={shared.num}>
                Purchased
              </th>
              <th scope="col" className={shared.num}>
                Consumed
              </th>
              <th scope="col" className={shared.num}>
                In stock
              </th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loaded.loading ? (
              <tr>
                <td colSpan={7} className={shared.status} style={{ textAlign: "center", padding: 20 }}>
                  No items match.
                </td>
              </tr>
            ) : null}
            {rows.map((r) => (
              <tr key={r.variation_id}>
                <td>{r.product_name}</td>
                <td>{r.variation_name}</td>
                <td className={shared.num}>{r.opening}</td>
                <td className={shared.num}>{r.purchased}</td>
                <td className={shared.num}>{r.consumed}</td>
                <td className={`${shared.num} ${shared.strong}`}>{r.in_stock}</td>
                <td>
                  <Pill status={r.status} label={STATUS_LABEL[r.status]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        page={data?.page ?? page}
        pages={data?.pages ?? 1}
        hrefFor={(n) => (n === 1 ? pathname : `${pathname}?stock_page=${n}`)}
        summary={data ? `Showing ${rows.length} of ${data.total} variations` : "Loading…"}
      />
    </section>
  );
}

export function CurrentStockWidget({ widget }: { widget: Widget }) {
  return (
    <Suspense fallback={<section className={`card ${styles.widget}`}>Loading…</section>}>
      <CurrentStockTable widget={widget} />
    </Suspense>
  );
}

/**
 * Renderers for the stock module's dashboard widgets, keyed by the `kind`
 * app/modules/stock returns. TODO(main): spread this map into WIDGETS in
 * web/components/widgets/index.tsx so the shared dashboard renders them.
 */
export const STOCK_WIDGETS: Record<string, StockWidgetComponent> = {
  stock_stats: StockStatsWidget,
  stock_low: LowStockWidget,
  stock_current: CurrentStockWidget,
};
