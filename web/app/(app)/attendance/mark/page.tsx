import type { Metadata } from "next";
import { MarkPage } from "@/components/attendance/MarkPage";

export const metadata: Metadata = { title: "Mark attendance" };

export default function AttendanceMarkRoute() {
  return <MarkPage />;
}
