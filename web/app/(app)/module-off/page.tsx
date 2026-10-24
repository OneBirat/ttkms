import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "Module turned off" };

const TITLES: Record<string, string> = {
  attendance: "Attendance",
  payroll: "People & payroll",
  admin: "Admin",
};

/**
 * Landing page for a route whose module is not in ENABLED_MODULES
 * (middleware.ts sends the user here, e.g. from /people/employees while
 * payroll is paused).
 */
export default async function ModuleOffPage({
  searchParams,
}: {
  searchParams: Promise<{ module?: string }>;
}) {
  const { module } = await searchParams;
  const title = (module && TITLES[module]) || "This";
  return (
    <>
      <PageHeader title="This module is turned off" />
      <EmptyState
        icon="box"
        title={`${title} module is turned off`}
        text="It has been paused by the administrator. Everything else keeps working."
      >
        <Link href="/" className="btn btn--primary">
          Go to the dashboard
        </Link>
      </EmptyState>
    </>
  );
}
