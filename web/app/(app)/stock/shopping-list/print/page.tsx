import type { Metadata } from "next";
import { Suspense } from "react";
import { ShoppingListPrint } from "@/components/stock/ShoppingListPrint";

export const metadata: Metadata = { title: "Shopping list" };

export default function Page() {
  return (
    <Suspense fallback={<p className="muted">Preparing…</p>}>
      <ShoppingListPrint />
    </Suspense>
  );
}
