"use client";

import { PageHeader } from "@/components/ui/PageHeader";
import type { Widget } from "@/lib/api";
import { CurrentStockWidget, LowStockWidget, StockStatsWidget } from "./widgets";

const widget = (kind: string, title: string): Widget => ({ module: "stock", kind, title, data: {} });

/**
 * /stock: the stock module's own overview, rendering exactly the widgets it
 * registers for the dashboard (so they are reachable before main wires the
 * widget kinds into the shared dashboard).
 */
export function StockOverview() {
  return (
    <>
      <PageHeader title="Stock" subtitle="Today's stock position: what is low, what moved, and every variation's balance." />
      <StockStatsWidget widget={widget("stock_stats", "Stock")} />
      <LowStockWidget widget={widget("stock_low", "Low in stock")} />
      <CurrentStockWidget widget={widget("stock_current", "Current stock")} />
    </>
  );
}
