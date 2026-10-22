import type { Metadata } from "next";
import { StockEntryPage } from "@/components/stock/StockEntryPage";

export const metadata: Metadata = { title: "Stock entry" };

export default function Page() {
  return <StockEntryPage />;
}
