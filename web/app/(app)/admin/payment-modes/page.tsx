import type { Metadata } from "next";
import { PaymentModesPage } from "@/components/admin/payment-modes/PaymentModesPage";

export const metadata: Metadata = { title: "Payment modes" };

export default function Page() {
  return <PaymentModesPage />;
}
