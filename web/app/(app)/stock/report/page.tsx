import type { Metadata } from "next";
import { Suspense } from "react";
import { StockReportPage } from "@/components/stock/StockReportPage";

export const metadata: Metadata = { title: "Stock report" };

export default function Page() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <StockReportPage />
    </Suspense>
  );
}
