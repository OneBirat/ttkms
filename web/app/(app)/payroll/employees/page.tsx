import type { Metadata } from "next";
import { EmployeesScreen } from "@/components/payroll/EmployeesScreen";

export const metadata: Metadata = { title: "Employees" };

export default function EmployeesPage() {
  return <EmployeesScreen selectedId={null} />;
}
