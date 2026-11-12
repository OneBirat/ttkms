import type { Metadata } from "next";
import { Suspense } from "react";
import { PayslipSheets } from "@/app/people/_components/PayslipSheets";

export const metadata: Metadata = { title: "Pay slips" };

/**
 * The pay slip print page (Salary report → Preview / Print): outside the (shell) group, so no
 * sidebar - only a slim toolbar (hidden in print) and the A4 sheets.
 */
export default function PayslipsPage() {
  return (
    <Suspense fallback={<p className="muted" style={{ padding: 16 }}>Loading…</p>}>
      <PayslipSheets />
    </Suspense>
  );
}
