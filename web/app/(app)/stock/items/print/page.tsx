import type { Metadata } from "next";
import { Suspense } from "react";
import { ItemsPrint } from "@/components/stock/ItemsPrint";

export const metadata: Metadata = { title: "Stock list" };

export default function Page() {
  return (
    <Suspense fallback={<p className="muted">Preparing…</p>}>
      <ItemsPrint />
    </Suspense>
  );
}
