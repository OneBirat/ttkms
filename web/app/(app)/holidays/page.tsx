import type { Metadata } from "next";
import { HolidayPage } from "@/components/attendance/holidays/HolidayPage";

export const metadata: Metadata = { title: "Holiday calendar" };

export default function HolidaysRoute() {
  return <HolidayPage />;
}
