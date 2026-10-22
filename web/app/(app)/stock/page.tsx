import type { Metadata } from "next";
import { Suspense } from "react";
import { StockOverview } from "@/components/stock/StockOverview";

export const metadata: Metadata = { title: "Stock" };

export default function StockPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <StockOverview />
    </Suspense>
  );
}
