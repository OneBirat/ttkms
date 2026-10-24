import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EmployeeAccountScreen } from "@/app/people/_components/EmployeeAccountScreen";
import { Responsive } from "@/app/people/_components/Responsive";
import { PhoneAccount } from "@/app/people/_components/phone/PhoneAccount";

export const metadata: Metadata = { title: "Employee" };

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <Responsive phone={<PhoneAccount id={Number(id)} />} desktop={<EmployeeAccountScreen id={Number(id)} />} />
    </Suspense>
  );
}
