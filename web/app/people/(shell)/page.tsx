import { redirect } from "next/navigation";

/** /people opens the Employees screen. */
export default function PeopleIndexPage() {
  redirect("/people/employees");
}
