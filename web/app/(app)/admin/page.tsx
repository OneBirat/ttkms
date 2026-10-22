import { redirect } from "next/navigation";

/** /admin has no page of its own: land on Users & roles. */
export default function AdminIndexPage() {
  redirect("/admin/users");
}
