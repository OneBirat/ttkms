import type { Metadata } from "next";
import { Suspense } from "react";
import { AuditPage } from "@/components/admin/audit/AuditPage";

export const metadata: Metadata = { title: "Audit log" };

export default function Page() {
  // useSearchParams() inside AuditPage needs a Suspense boundary for the static build.
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <AuditPage />
    </Suspense>
  );
}
