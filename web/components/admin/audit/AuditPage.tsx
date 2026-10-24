"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BSDateRangePicker, BSDateTimeText } from "@/components/date";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { Pill } from "@/components/ui/Pill";
import { errorMessage } from "@/lib/api";
import { exportAudit, listAudit, listAuditUsers } from "../api";
import { AUDIT_MODULES, type AuditEntry, type AuditListParams, type AuditModule } from "../types";
import { AdminGate } from "../components/AdminGate";
import { Select } from "../components/Field";
import { Toast, useToast } from "../components/Toast";
import { useLoader } from "../components/useLoader";
import { AuditDrawer } from "./AuditDrawer";
import { MODULE_TONE, actionLabel } from "./labels";
import styles from "../components/admin.module.css";

const TITLE = "Audit log";
const SUBTITLE = "Every change, who made it and when. Nothing here can be edited.";

const COLUMNS: Column[] = [
  { key: "when", label: "When" },
  { key: "user", label: "User" },
  { key: "module", label: "Module" },
  { key: "action", label: "Action" },
  { key: "what", label: "What" },
  { key: "view", label: "Details", align: "right" },
];

export function AuditPage() {
  return (
    <AdminGate page="audit" title={TITLE} subtitle={SUBTITLE}>
      {() => <AuditScreen />}
    </AdminGate>
  );
}

/** Filters live in the query string so pagination links and back/forward work. */
function paramsFrom(search: URLSearchParams): Required<Omit<AuditListParams, "page_size">> {
  const moduleParam = search.get("module") ?? "";
  const user = Number(search.get("user") ?? "");
  const page = Number(search.get("page") ?? "1");
  return {
    from_bs: search.get("from") ?? "",
    to_bs: search.get("to") ?? "",
    module: AUDIT_MODULES.some((m) => m.value === moduleParam) ? (moduleParam as AuditModule) : "",
    user_id: Number.isInteger(user) && user > 0 ? user : null,
    q: search.get("q") ?? "",
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

function AuditScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const params = useMemo(() => paramsFrom(new URLSearchParams(search.toString())), [search]);
  const { toast, show, dismiss } = useToast();

  const [qDraft, setQDraft] = useState(params.q);
  useEffect(() => setQDraft(params.q), [params.q]);

  const setParams = useCallback(
    (patch: Partial<Record<"from" | "to" | "module" | "user" | "q" | "page", string>>) => {
      const next = new URLSearchParams(search.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      if (!("page" in patch)) next.delete("page");
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [router, pathname, search],
  );

  // Debounce the free-text search into the URL.
  useEffect(() => {
    if (qDraft === params.q) return;
    const handle = setTimeout(() => setParams({ q: qDraft.trim() }), 300);
    return () => clearTimeout(handle);
  }, [qDraft, params.q, setParams]);

  const key = JSON.stringify(params);
  const page = useLoader(() => listAudit(params), key);
  const users = useLoader(listAuditUsers);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [exporting, setExporting] = useState(false);

  const hrefFor = (n: number) => {
    const next = new URLSearchParams(search.toString());
    if (n > 1) next.set("page", String(n));
    else next.delete("page");
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  };

  const doExport = async () => {
    setExporting(true);
    try {
      const blob = await exportAudit(params);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const range = [params.from_bs || "start", params.to_bs || "today"].join("_to_");
      a.href = url;
      a.download = `audit-log_${range}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      show("Export downloaded.");
    } catch (err) {
      show(errorMessage(err), "danger");
    }
    setExporting(false);
  };

  const rows = (page.data?.items ?? []).map((entry) => ({
    id: entry.id,
    when: <BSDateTimeText value={entry.at} className={styles.when} />,
    user: entry.user ? (
      <span>
        <span className={styles.primary}>{entry.user.full_name}</span>
        <span className={`${styles.secondary} mono`}>{entry.user.username}</span>
      </span>
    ) : (
      <span className="muted">System</span>
    ),
    module: (
      <Pill status={MODULE_TONE[entry.module]} label={entry.module} className={styles.modulePill} />
    ),
    action: actionLabel(entry),
    what: (
      <span>
        {entry.entity.replace(/_/g, " ")}
        {entry.entity_id ? <span className={styles.code}> {entry.entity_id}</span> : null}
      </span>
    ),
    view: (
      <button
        type="button"
        className={styles.ghost}
        onClick={() => setSelected(entry)}
        aria-label={`View details of ${actionLabel(entry)} ${entry.entity_id ?? ""}`}
      >
        View
      </button>
    ),
  }));

  const total = page.data?.total ?? 0;
  const hasFilters = Boolean(
    params.from_bs || params.to_bs || params.module || params.user_id || params.q,
  );

  return (
    <div className={styles.stack}>
      <PageHeader
        title={TITLE}
        subtitle={SUBTITLE}
        actions={
          <button
            type="button"
            className="btn"
            onClick={() => void doExport()}
            disabled={exporting || total === 0}
          >
            {exporting ? "Exporting…" : "Excel export"}
          </button>
        }
      />

      <section aria-label="Audit entries">
        <form
          className={`card ${styles.filters}`}
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setParams({ q: qDraft.trim() });
          }}
        >
          <div className={styles.filterField}>
            <BSDateRangePicker
              value={{ from: params.from_bs, to: params.to_bs }}
              onChange={(range) => setParams({ from: range.from, to: range.to })}
              size="sm"
              noFutureDays
              clearable
              placeholder="Any date"
            />
          </div>
          <div className={`${styles.filterField} ${styles.narrow}`}>
            <label htmlFor="audit-module" className={styles.filterLabel}>
              Module
            </label>
            <Select
              id="audit-module"
              value={params.module}
              onChange={(event) => setParams({ module: event.target.value })}
            >
              <option value="">All modules</option>
              {AUDIT_MODULES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </div>
          <div className={`${styles.filterField} ${styles.narrow}`}>
            <label htmlFor="audit-user" className={styles.filterLabel}>
              User
            </label>
            <Select
              id="audit-user"
              value={params.user_id ? String(params.user_id) : ""}
              onChange={(event) => setParams({ user: event.target.value })}
            >
              <option value="">Anyone</option>
              {(users.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name}
                </option>
              ))}
            </Select>
          </div>
          <div className={`${styles.filterField} ${styles.search}`}>
            <label htmlFor="audit-q" className={styles.filterLabel}>
              Search
            </label>
            <input
              id="audit-q"
              className="input"
              type="search"
              placeholder="Action, entity, ID or value"
              value={qDraft}
              onChange={(event) => setQDraft(event.target.value)}
            />
          </div>
          {hasFilters ? (
            <div className={styles.filterActions}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setQDraft("");
                  router.replace(pathname, { scroll: false });
                }}
              >
                Clear filters
              </button>
            </div>
          ) : null}
        </form>

        <p className={styles.summary} role="status">
          {page.loading
            ? "Loading…"
            : `${total} entr${total === 1 ? "y" : "ies"}${hasFilters ? " matching the filters" : ""}`}
        </p>

        {page.error ? (
          <EmptyState icon="alert" title="Could not load the audit log" text={errorMessage(page.error)}>
            <button type="button" className="btn" onClick={page.reload}>
              Try again
            </button>
          </EmptyState>
        ) : (
          <>
            <DataTable
              columns={COLUMNS}
              rows={rows}
              caption="Audit log"
              emptyText={page.loading ? "Loading…" : "No entries match these filters."}
            />
            {page.data && page.data.pages > 1 ? (
              <Pagination page={page.data.page} pages={page.data.pages} hrefFor={hrefFor} />
            ) : null}
          </>
        )}
      </section>

      <AuditDrawer entry={selected} onClose={() => setSelected(null)} />
      <Toast toast={toast} onDismiss={dismiss} />
    </div>
  );
}
