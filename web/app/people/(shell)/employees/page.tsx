import type { Metadata } from "next";
import { EmployeesScreen } from "@/app/people/_components/EmployeesScreen";

export const metadata: Metadata = { title: "Employees" };

export default function EmployeesPage() {
  return <EmployeesScreen selectedId={null} />;
}
