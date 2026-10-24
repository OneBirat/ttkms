import type { Metadata } from "next";
import { BarcodesPage } from "@/components/admin/barcodes/BarcodesPage";

export const metadata: Metadata = { title: "Employee barcodes" };

export default function Page() {
  return <BarcodesPage />;
}
