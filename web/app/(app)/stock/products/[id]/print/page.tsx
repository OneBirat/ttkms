import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ProductHistoryPrint } from "@/components/stock/ProductHistoryPrint";

export const metadata: Metadata = { title: "Product history" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const productId = Number(id);
  if (!Number.isInteger(productId) || productId <= 0) notFound();
  return (
    <Suspense fallback={<p className="muted">Preparing…</p>}>
      <ProductHistoryPrint id={productId} />
    </Suspense>
  );
}
