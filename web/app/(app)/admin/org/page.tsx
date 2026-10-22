import type { Metadata } from "next";
import { OrgPage } from "@/components/admin/org/OrgPage";

export const metadata: Metadata = { title: "Branches & departments" };

export default function Page() {
  return <OrgPage />;
}
