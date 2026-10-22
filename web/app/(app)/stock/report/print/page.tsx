import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportPrint } from "@/components/stock/ReportPrint";

export const metadata: Metadata = { title: "Stock report" };

export default function Page() {
  return (
    <Suspense fallback={<p className="muted">Preparing…</p>}>
      <ReportPrint />
    </Suspense>
  );
}
