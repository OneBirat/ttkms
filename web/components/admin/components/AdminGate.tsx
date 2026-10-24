"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { useSession } from "@/lib/session";
import { setMockActor } from "../api";
import { adminPageAccess, type AdminPage, type PageAccess } from "../permissions";

export interface AdminGateProps {
  page: AdminPage;
  title: string;
  subtitle: string;
  /** Receives "full" or "view"; "none" never renders children. */
  children: (access: Exclude<PageAccess, "none">) => ReactNode;
}

/**
 * Role gate for the admin pages: admins get everything, managers may view
 * Branches & departments, everyone else sees "Access denied".
 */
export function AdminGate({ page, title, subtitle, children }: AdminGateProps) {
  const { user } = useSession();

  useEffect(() => {
    if (user) setMockActor(user);
  }, [user]);

  const access = adminPageAccess(user?.role, page);
  if (access === "none") {
    return (
      <>
        <PageHeader title={title} subtitle={subtitle} />
        <EmptyState
          icon="shield"
          title="Access denied"
          text="Only admins can open this page."
        >
          <Link href="/" className="btn btn--primary">
            Back to the dashboard
          </Link>
        </EmptyState>
      </>
    );
  }
  return <>{children(access)}</>;
}
