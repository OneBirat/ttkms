import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/ModulePlaceholder";

export const metadata: Metadata = { title: "Attendance" };

export default function AttendancePage() {
  return (
    <ModulePlaceholder
      name="attendance"
      title="Attendance"
      subtitle="Daily attendance, late marks and leave"
    />
  );
}
