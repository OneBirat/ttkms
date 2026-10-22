import { redirect } from "next/navigation";

/** /payroll opens the Employees screen. */
export default function PayrollIndexPage() {
  redirect("/payroll/employees");
}
