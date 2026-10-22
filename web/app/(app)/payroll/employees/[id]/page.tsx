import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmployeesScreen } from "@/components/payroll/EmployeesScreen";

export const metadata: Metadata = { title: "Employee" };

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  return <EmployeesScreen selectedId={Number(id)} />;
}
