import type { Metadata } from "next";
import { ItemsPage } from "@/components/stock/ItemsPage";

export const metadata: Metadata = { title: "Items" };

export default function Page() {
  return <ItemsPage />;
}
