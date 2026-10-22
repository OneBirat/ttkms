import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/ModulePlaceholder";

export const metadata: Metadata = { title: "People & payroll" };

export default function PayrollPage() {
  return (
    <ModulePlaceholder
      name="payroll"
      title="People & payroll"
      subtitle="Employees, salaries and monthly payroll"
    />
  );
}
