import type { Metadata } from "next";
import { Suspense } from "react";
import { Responsive } from "@/app/people/_components/Responsive";
import { SalaryReportScreen } from "@/app/people/_components/SalaryReportScreen";
import { PhoneSalaryReport } from "@/app/people/_components/phone/PhoneSalaryReport";

export const metadata: Metadata = { title: "Salary report" };

export default function SalaryPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <Responsive phone={<PhoneSalaryReport />} desktop={<SalaryReportScreen />} />
    </Suspense>
  );
}
