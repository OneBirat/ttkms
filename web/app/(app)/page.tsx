import type { Metadata } from "next";
import { Suspense } from "react";
import { Dashboard } from "@/components/Dashboard";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  // useSearchParams() (?view=compare) inside the dashboard needs a Suspense boundary.
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <Dashboard />
    </Suspense>
  );
}
