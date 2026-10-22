import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/ModulePlaceholder";

export const metadata: Metadata = { title: "Stock" };

export default function StockPage() {
  return (
    <ModulePlaceholder
      name="stock"
      title="Stock"
      subtitle="Items, purchases, sales and stock levels"
    />
  );
}
