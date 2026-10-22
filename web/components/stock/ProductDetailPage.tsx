"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { EmptyState } from "@/components/ui/EmptyState";
import { Segmented } from "@/components/ui/Segmented";
import { EditProductModal } from "./EditModals";
import * as api from "./api";
import {
  formatAdLong,
  formatAdShort,
  nextBsMonth,
  parseBsIso,
  previousBsMonth,
  SATURDAY,
  WEEKDAY_INITIALS_NP,
  WEEKDAY_NAMES_NP,
  bsSupported,
} from "./calendar";
import { downloadCsv } from "./csv";
import { fixed1, isMonthBoundary, plural, signed } from "./helpers";
import { useAsync } from "./useAsync";
import type { CalendarDay, Product } from "./types";
import shared from "./stock.module.css";
import styles from "./product.module.css";

type Mode = "both" | "in" | "out";
type AvgPer = "day" | "week" | "month";
type View = "cal" | "table";
const RANGES = [7, 30, 60, 90] as const;
type Range = (typeof RANGES)[number];

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: "cal", label: "Calendar" },
  { value: "table", label: "Table" },
];
const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: "both", label: "Both" },
  { value: "in", label: "Purchase" },
  { value: "out", label: "Sales" },
];
const AVG_OPTIONS: { value: AvgPer; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

export function ProductDetailPage({ id }: { id: number }) {
  const router = useRouter();
  const products = useAsync(() => api.listProducts(), "products");
  const today = useAsync(() => api.getToday(), "today");
  const [variationId, setVariationId] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("both");
  const [avgPer, setAvgPer] = useState<AvgPer>("day");
  const [view, setView] = useState<View>("cal");
  const [range, setRange] = useState<Range>(30);
  const [month, setMonth] = useState<{ year: number; month: number } | null>(null);
  const [editing, setEditing] = useState(false);

  const product: Product | null = products.data?.products.find((p) => p.id === id) ?? null;
  const scopeKey = `${id}:${variationId ?? "all"}`;
  const stats = useAsync(() => api.getProductStats(id, variationId), scopeKey);

  const todayBs = today.data ? parseBsIso(today.data.bs) : null;
  const current = month ?? (todayBs ? { year: todayBs.year, month: todayBs.month } : null);
  const calKey = current ? `${scopeKey}:${current.year}-${current.month}` : "";
  const calendar = useAsync(
    () => (current ? api.getCalendarMonth(id, variationId, current.year, current.month) : Promise.reject(new Error("no month"))),
    calKey,
  );
  const history = useAsync(() => api.getDailyHistory(id, variationId, range), `${scopeKey}:${range}`);

  // Switching product resets the variation tab.
  useEffect(() => {
    setVariationId(null);
  }, [id]);

  const tabs = useMemo(
    () =>
      product
        ? [
            { id: null, name: "All variations", stock: product.variations.reduce((a, v) => a + v.in_stock, 0) },
            ...product.variations.map((v) => ({ id: v.id, name: v.name, stock: v.in_stock })),
          ]
        : [],
    [product],
  );

  if (products.error) {
    return (
      <EmptyState icon="alert" title="Could not load the product" text={products.error}>
        <button type="button" className="btn" onClick={products.reload}>
          Try again
        </button>
      </EmptyState>
    );
  }
  if (products.data && !product) {
    return (
      <EmptyState icon="box" title="Product not found" text="It may have been removed.">
        <Link href="/stock/items" className="btn btn--primary">
          Back to Items
        </Link>
      </EmptyState>
    );
  }

  const s = stats.data;
  const monthName = s?.month_name ?? "";
  const avgValue =
    s === null ? "…" : avgPer === "day" ? fixed1(s.avg_per_day) : avgPer === "week" ? fixed1(s.avg_per_week) : String(Math.round(s.avg_per_month));
  const avgNote =
    avgPer === "day"
      ? "per open day (Saturday closed)"
      : avgPer === "week"
        ? `per week, ${monthName} ${todayBs?.year ?? ""} (Sun–Sat weeks)`
        : "per month, average of last 6 months";
  const cover = s === null ? "…" : s.in_stock <= 0 ? "Out of stock" : s.days_left === null ? "No sales yet" : `${s.days_left} days`;

  const canGoNext = !!current && !!todayBs && (current.year < todayBs.year || (current.year === todayBs.year && current.month < todayBs.month));
  const canGoPrev = !!current && bsSupported(previousBsMonth(current.year, current.month).year);

  const historyRows = history.data?.rows ?? [];
  const printHref = `/stock/products/${id}/print?variation=${variationId ?? ""}&days=${range}&mode=${mode}&auto=1`;

  const exportCsv = () => {
    if (!history.data || !product) return;
    downloadCsv(
      `${product.name} history ${range} days`,
      ["Date (BS)", "Day", "Date (AD)", "Purchased", "Sold / used", "Closing stock"],
      historyRows.map((r) => [r.date_bs, WEEKDAY_INITIALS_NP[r.weekday], r.date_ad, r.purchased, r.sold, r.closing]),
    );
  };

  return (
    <>
      <Link href="/stock/items" className={shared.backLink}>
        <Icon name="chevron-left" size={16} />
        Items
      </Link>
      <header className={shared.toolbar} style={{ padding: 0, alignItems: "flex-end", justifyContent: "space-between" }}>
        <div className={styles.titleRow}>
          <label htmlFor="product-select" className="sr-only">
            Product
          </label>
          <h1>
            <span className={styles.selectWrap}>
              <select
                id="product-select"
                className={styles.select}
                value={id}
                onChange={(e) => router.push(`/stock/products/${e.target.value}`)}
              >
                {(products.data?.products ?? (product ? [product] : [])).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                {!products.data ? <option value={id}>Loading…</option> : null}
              </select>
              <Icon name="chevron-right" size={20} className={styles.selectIcon} style={{ transform: "rotate(90deg)" }} />
            </span>
          </h1>
          <span className={styles.subtitle}>
            {product ? `${plural(product.variations.length, "variation")} by ${product.variations_by.toLowerCase()} · ${product.unit}` : " "}
          </span>
        </div>
        <div className={shared.actions}>
          <button type="button" className="btn" onClick={() => setEditing(true)} disabled={!product}>
            Edit product
          </button>
        </div>
      </header>

      <div role="group" aria-label="Variation" className={styles.tabs}>
        {tabs.map((t) => (
          <button
            key={t.id ?? "all"}
            type="button"
            className={styles.tab}
            aria-pressed={t.id === variationId}
            onClick={() => setVariationId(t.id)}
          >
            <strong>{t.name}</strong>
            <small>{t.stock} in stock</small>
          </button>
        ))}
      </div>

      <section aria-label="Key numbers" className={shared.kpis}>
        <div className={`card ${shared.kpi}`}>
          <span className={shared.kpiLabel}>In stock now</span>
          <span className={shared.kpiValue}>
            {s?.in_stock ?? "…"} <small>pcs</small>
          </span>
        </div>
        <div className={`card ${shared.kpi}`}>
          <span className={shared.kpiLabel}>Purchased in {monthName}</span>
          <span className={`${shared.kpiValue} ${shared.in}`}>+{s?.purchased_this_month ?? "…"}</span>
        </div>
        <div className={`card ${shared.kpi}`}>
          <span className={shared.kpiLabel}>Sold / used in {monthName}</span>
          <span className={`${shared.kpiValue} ${shared.out}`}>−{s?.sold_this_month ?? "…"}</span>
        </div>
        <div className={`card ${shared.kpi}`} style={{ paddingTop: 10 }}>
          <div className={styles.kpiHead}>
            <span className={shared.kpiLabel}>Average sold</span>
            <div role="group" aria-label="Average per" className={styles.miniSeg}>
              {AVG_OPTIONS.map((o) => (
                <button key={o.value} type="button" aria-pressed={avgPer === o.value} onClick={() => setAvgPer(o.value)}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <span className={shared.kpiValue}>{avgValue} pcs</span>
          <span className={shared.kpiNote}>{avgNote}</span>
        </div>
        <div className={`card ${shared.kpi}`}>
          <span className={shared.kpiLabel}>Stock lasts about</span>
          <span className={shared.kpiValue}>{cover}</span>
        </div>
      </section>

      <div className={styles.columns}>
        <section aria-labelledby="history-h" className={`card ${styles.history}`}>
          <div className={styles.historyBar}>
            <Segmented options={VIEW_OPTIONS} value={view} onChange={setView} label="View as" />
            <Segmented options={MODE_OPTIONS} value={mode} onChange={setMode} label="Show" />
          </div>

          {view === "cal" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className={styles.monthNav}>
                <button
                  type="button"
                  className={styles.navButton}
                  aria-label="Previous month"
                  disabled={!canGoPrev}
                  onClick={() => current && setMonth(previousBsMonth(current.year, current.month))}
                >
                  ‹
                </button>
                <h2 id="history-h">
                  {calendar.data ? (
                    <>
                      {calendar.data.month_name} {calendar.data.year}{" "}
                      <span lang="ne">· {calendar.data.month_name_np}</span>
                    </>
                  ) : (
                    "…"
                  )}
                </h2>
                <button
                  type="button"
                  className={styles.navButton}
                  aria-label="Next month"
                  disabled={!canGoNext}
                  onClick={() => current && setMonth(nextBsMonth(current.year, current.month))}
                >
                  ›
                </button>
              </div>
              <div className={styles.grid} aria-busy={calendar.loading}>
                {WEEKDAY_INITIALS_NP.map((w, i) => (
                  <span key={w} lang="ne" className={`${styles.weekday} ${i === SATURDAY ? styles.weekdaySat : ""}`}>
                    {w}
                  </span>
                ))}
                {calendar.data
                  ? [
                      ...Array.from({ length: calendar.data.first_weekday }, (_, i) => (
                        <div key={`blank-${i}`} className={styles.cellBlank} aria-hidden="true" />
                      )),
                      ...calendar.data.days.map((d) => (
                        <CalendarCell key={d.day} day={d} mode={mode} maxSold={calendar.data?.max_sold ?? 0} monthName={calendar.data?.month_name ?? ""} />
                      )),
                    ]
                  : null}
              </div>
              <div className={styles.legend}>
                <span>
                  <span className={styles.swatch} style={{ background: "#cfe8e4" }} />
                  Purchase (+)
                </span>
                <span>
                  <span className={styles.swatch} style={{ background: "#f9dfb8" }} />
                  Sales / used (−), darker = more
                </span>
                <span>Saturdays in red · hover a day for details</span>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className={styles.historyBar}>
                <h2 id="history-h" style={{ fontSize: 17 }}>
                  Daily history · last {range} days
                </h2>
                <div role="group" aria-label="Period" className={shared.pillButtons}>
                  {RANGES.map((r) => (
                    <button key={r} type="button" className={shared.pillButton} aria-pressed={range === r} onClick={() => setRange(r)}>
                      {r} days
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.totals}>
                <div className={`${shared.tint} ${shared.tintIn}`}>
                  <span className={shared.tintLabel}>Purchased</span>
                  <span className={`${shared.tintValue} ${shared.in}`}>+{history.data?.purchased ?? "…"}</span>
                </div>
                <div className={`${shared.tint} ${shared.tintOut}`}>
                  <span className={shared.tintLabel}>Sold / used</span>
                  <span className={`${shared.tintValue} ${shared.out}`}>−{history.data?.sold ?? "…"}</span>
                </div>
                <div className={`${shared.tint} ${shared.tintNeutral}`}>
                  <span className={shared.tintLabel}>Avg sold per open day</span>
                  <span className={shared.tintValue}>{history.data ? fixed1(history.data.avg_sold_per_open_day) : "…"}</span>
                </div>
                <div className={`${shared.tint} ${shared.tintNeutral}`}>
                  <span className={shared.tintLabel}>Days with sales</span>
                  <span className={shared.tintValue}>
                    {history.data ? `${history.data.days_with_sales} / ${history.data.open_days}` : "…"}
                  </span>
                </div>
              </div>
              <div className={styles.scroll} aria-busy={history.loading}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Date (BS)</th>
                      <th scope="col">Day</th>
                      <th scope="col">Date (AD)</th>
                      {mode !== "out" ? (
                        <th scope="col" style={{ textAlign: "right" }}>
                          Purchased
                        </th>
                      ) : null}
                      {mode !== "in" ? (
                        <th scope="col" style={{ textAlign: "right" }}>
                          Sold / used
                        </th>
                      ) : null}
                      <th scope="col" style={{ textAlign: "right" }}>
                        Closing stock
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyRows.map((r, i) => (
                      <tr
                        key={r.date_ad}
                        className={`${r.weekday === SATURDAY ? styles.rowSat : ""} ${isMonthBoundary(historyRows, i) ? styles.rowMonth : ""}`}
                      >
                        <td className={shared.mono} style={{ fontSize: 12 }}>
                          {r.date_bs}
                        </td>
                        <td lang="ne" className={r.weekday === SATURDAY ? shared.satDay : undefined} style={{ color: r.weekday === SATURDAY ? undefined : "#3e4a52" }}>
                          {WEEKDAY_INITIALS_NP[r.weekday]}
                        </td>
                        <td className={shared.status}>{formatAdShort(r.date_ad)}</td>
                        {mode !== "out" ? (
                          <td className={`${shared.num} ${shared.in} ${shared.strong}`}>{signed(r.purchased, "+")}</td>
                        ) : null}
                        {mode !== "in" ? (
                          <td className={`${shared.num} ${shared.out} ${shared.strong}`}>{signed(r.sold, "−")}</td>
                        ) : null}
                        <td className={shared.num}>{r.closing}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={styles.tableFoot}>
                <span>Newest first · Saturdays (closed) greyed · {historyRows.length} days</span>
                <div>
                  <button type="button" className={`btn ${styles.smallBtn}`} onClick={exportCsv} disabled={!history.data}>
                    Excel
                  </button>
                  <a href={printHref} target="_blank" rel="noopener" className={`btn ${styles.smallBtn}`}>
                    PDF
                  </a>
                </div>
              </div>
            </div>
          )}
        </section>

        <div className={styles.side}>
          <WeekdayChart sales={s?.weekday_sales ?? null} note={`${monthName} ${todayBs?.year ?? ""} · Saturday is closed`} />
          <TrendChart months={s?.last_6_months ?? null} />
          <section aria-labelledby="patterns-h" className={styles.patterns}>
            <h2 id="patterns-h">Patterns</h2>
            {s ? s.patterns.map((text) => <p key={text}>• {text}</p>) : <p className="muted">…</p>}
          </section>
        </div>
      </div>

      <EditProductModal
        product={editing ? product : null}
        existing={products.data?.products ?? []}
        onClose={() => setEditing(false)}
        onSaved={() => products.reload()}
      />
    </>
  );
}

function CalendarCell({ day, mode, maxSold, monthName }: { day: CalendarDay; mode: Mode; maxSold: number; monthName: string }) {
  const sat = day.weekday === SATURDAY;
  const showIn = mode !== "out" && day.purchased > 0;
  const showOut = mode !== "in" && day.sold > 0;
  let tone = "";
  if (showOut) {
    const t = maxSold ? day.sold / maxSold : 0;
    tone = t > 0.66 ? styles.sold3 : t > 0.33 ? styles.sold2 : styles.sold1;
  } else if (showIn) {
    tone = styles.cellBought;
  }
  const classes = [styles.cell, sat ? styles.cellSat : tone, showIn && showOut ? styles.cellBoth : ""].join(" ");
  const title = `${monthName} ${day.day} (${formatAdLong(day.date_ad)}, ${WEEKDAY_NAMES_NP[day.weekday]}): +${day.purchased} purchased, −${day.sold} sold`;
  return (
    <div className={classes} title={title} aria-label={title}>
      <span className={`${styles.cellDay} ${sat ? shared.satDay : ""}`}>{day.day}</span>
      {showIn ? <span className={styles.cellIn}>+{day.purchased}</span> : null}
      {showOut ? <span className={styles.cellOut}>−{day.sold}</span> : null}
    </div>
  );
}

function WeekdayChart({ sales, note }: { sales: number[] | null; note: string }) {
  const values = sales ?? [0, 0, 0, 0, 0, 0, 0];
  const max = Math.max(...values, 1);
  const best = values.indexOf(Math.max(...values));
  const alt = `Sales by weekday: ${values.map((v, i) => `${WEEKDAY_NAMES_NP[i]} ${v}`).join(", ")}`;
  return (
    <section aria-labelledby="wk-h" className={`card ${styles.chartCard}`}>
      <div className={styles.chartTitle}>
        <h2 id="wk-h">Sales by weekday</h2>
        <span>{note}</span>
      </div>
      <div role="img" aria-label={alt} className={styles.bars}>
        {values.map((v, i) => (
          <div key={i} className={styles.barCol}>
            <span className={styles.barValue}>{v}</span>
            <div
              className={`${styles.bar} ${i === best && v > 0 ? styles.barBest : ""}`}
              style={{ height: Math.max(2, Math.round((v / max) * 100)) }}
            />
          </div>
        ))}
      </div>
      <div className={styles.barLabels}>
        {WEEKDAY_INITIALS_NP.map((w) => (
          <span key={w} lang="ne">
            {w}
          </span>
        ))}
      </div>
    </section>
  );
}

function TrendChart({ months }: { months: { label: string; purchased: number; sold: number }[] | null }) {
  const list = months ?? [];
  const max = Math.max(...list.map((m) => Math.max(m.purchased, m.sold)), 1) * 1.3;
  const alt = list.length ? `Purchased and sold per month from ${list[0].label} to ${list[list.length - 1].label}` : "Last 6 months";
  return (
    <section aria-labelledby="tr-h" className={`card ${styles.chartCard}`}>
      <div className={styles.chartTitle}>
        <h2 id="tr-h">Last 6 months</h2>
        <span>Purchased vs sold, pcs per month</span>
      </div>
      <div role="img" aria-label={alt} className={styles.bars} style={{ gap: 12 }}>
        {list.map((m) => (
          <div key={m.label} className={styles.pairCol}>
            <div className={styles.barIn} title={`${m.label}: ${m.purchased} purchased`} style={{ height: Math.round((m.purchased / max) * 110) }} />
            <div className={styles.barOut} title={`${m.label}: ${m.sold} sold`} style={{ height: Math.round((m.sold / max) * 110) }} />
          </div>
        ))}
      </div>
      <div className={styles.barLabels} style={{ gap: 12 }}>
        {list.map((m) => (
          <span key={m.label} style={{ fontSize: 11 }}>
            {m.label}
          </span>
        ))}
      </div>
      <div className={styles.legend} style={{ gap: 14 }}>
        <span>
          <span className={styles.swatch} style={{ width: 10, height: 10, background: "var(--color-primary)" }} />
          Purchased
        </span>
        <span>
          <span className={styles.swatch} style={{ width: 10, height: 10, background: "#c98a3a" }} />
          Sold / used
        </span>
      </div>
    </section>
  );
}
