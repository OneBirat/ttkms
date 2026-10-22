import { redirect } from "next/navigation";

/** /attendance has no screen of its own: go to Mark attendance. */
export default function AttendanceIndex() {
  redirect("/attendance/mark");
}
