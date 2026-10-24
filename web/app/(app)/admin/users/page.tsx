import type { Metadata } from "next";
import { UsersPage } from "@/components/admin/users/UsersPage";

export const metadata: Metadata = { title: "Users & roles" };

export default function Page() {
  return <UsersPage />;
}
