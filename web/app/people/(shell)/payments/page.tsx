import type { Metadata } from "next";
import { Suspense } from "react";
import { PaymentsRegisterScreen } from "@/app/people/_components/PaymentsRegisterScreen";

export const metadata: Metadata = { title: "Payments" };

export default function PaymentsPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <PaymentsRegisterScreen />
    </Suspense>
  );
}
