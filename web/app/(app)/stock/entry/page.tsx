import type { Metadata } from "next";
import { Suspense } from "react";
import { StockEntryPage } from "@/components/stock/StockEntryPage";

export const metadata: Metadata = { title: "Stock entry" };

export default function Page() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <StockEntryPage />
    </Suspense>
  );
}
