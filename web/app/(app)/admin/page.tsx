import type { Metadata } from "next";
import { ModulePlaceholder } from "@/components/ModulePlaceholder";

export const metadata: Metadata = { title: "Admin" };

export default function AdminPage() {
  return (
    <ModulePlaceholder
      name="admin"
      title="Admin"
      subtitle="Users, roles, settings and audit log"
    />
  );
}
