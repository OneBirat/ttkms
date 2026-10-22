"use client";

import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  ApiError,
  errorMessage,
  type ModuleName,
  type ModulePlaceholderResponse,
} from "@/lib/api";
import { useApi } from "@/lib/useApi";

export interface ModulePlaceholderProps {
  name: ModuleName;
  title: string;
  subtitle: string;
}

export function ModulePlaceholder({
  name,
  title,
  subtitle,
}: ModulePlaceholderProps) {
  const { data, error, loading, reload } = useApi<ModulePlaceholderResponse>(
    `/api/${name}`,
  );

  let body;
  if (loading) {
    body = (
      <p className="muted" role="status">
        Loading…
      </p>
    );
  } else if (error instanceof ApiError && error.status === 403) {
    body = (
      <EmptyState
        icon="shield"
        title="Access denied"
        text="Your role does not have access to this module."
      >
        <Link href="/" className="btn btn--primary">
          Back to the dashboard
        </Link>
      </EmptyState>
    );
  } else if (error) {
    body = (
      <EmptyState
        icon="alert"
        title="Could not load this module"
        text={errorMessage(error)}
      >
        <button type="button" className="btn" onClick={reload}>
          Try again
        </button>
      </EmptyState>
    );
  } else {
    body = (
      <EmptyState
        icon="box"
        title="Coming soon"
        text={`The ${data?.title ?? title} module is on its way.`}
      />
    );
  }

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      {body}
    </>
  );
}
