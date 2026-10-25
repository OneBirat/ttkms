import type { Metadata } from "next";
import { Suspense } from "react";
import { PaymentsRegisterScreen } from "@/app/people/_components/PaymentsRegisterScreen";
import { Responsive } from "@/app/people/_components/Responsive";
import { PhonePayments } from "@/app/people/_components/phone/PhonePayments";

export const metadata: Metadata = { title: "Payment reports" };

export default function PaymentsPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <Responsive phone={<PhonePayments />} desktop={<PaymentsRegisterScreen />} />
    </Suspense>
  );
}
