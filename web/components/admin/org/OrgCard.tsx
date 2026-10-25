"use client";

import { useState, type FormEvent } from "react";
import { Pill } from "@/components/ui/Pill";
import { errorMessage } from "@/lib/api";
import { createOrg, deleteOrg, renameOrg, setOrgActive } from "../api";
import { findDuplicateName, validateName } from "../names";
import type { PageAccess } from "../permissions";
import type { Branch, Department, OrgKind } from "../types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import styles from "../components/admin.module.css";

export interface OrgCardProps {
  kind: OrgKind;
  title: string;
  note: string;
  items: (Branch | Department)[] | null;
  loading: boolean;
  error: unknown;
  access: Exclude<PageAccess, "none">;
  onChanged: (message: string) => void;
  onRetry: () => void;
}

const LABEL: Record<OrgKind, { one: string; add: string }> = {
  branch: { one: "branch", add: "Add branch" },
  department: { one: "department", add: "Add department" },
};

function countText(item: Branch | Department): string {
  if (item.employee_count === 0) return "No employees";
  const base = `${item.employee_count} employee${item.employee_count === 1 ? "" : "s"}`;
  return item.active_employee_count === item.employee_count
    ? base
    : `${base} · ${item.active_employee_count} active`;
}

export function OrgCard({
  kind,
  title,
  note,
  items,
  loading,
  error,
  access,
  onChanged,
  onRetry,
}: OrgCardProps) {
  const canEdit = access === "full";
  const label = LABEL[kind];
  const list = items ?? [];

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  const [confirm, setConfirm] = useState<{ item: Branch | Department; action: "activate" | "deactivate" | "delete" } | null>(
    null,
  );
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const liveDuplicate = (value: string, ignoreId: number | null) => {
    const clash = findDuplicateName(list, value, ignoreId);
    return clash ? `"${clash.name}" already exists.` : null;
  };

  const submitAdd = async (event: FormEvent) => {
    event.preventDefault();
    const problem = validateName(draft, `${title.slice(0, -1)} name`) ?? liveDuplicate(draft, null);
    if (problem) {
      setDraftError(problem);
      return;
    }
    setBusy(true);
    try {
      const row = await createOrg(kind, draft);
      setDraft("");
      setDraftError(null);
      setAdding(false);
      onChanged(`${row.name} added.`);
    } catch (err) {
      setDraftError(errorMessage(err));
    }
    setBusy(false);
  };

  const startRename = (item: Branch | Department) => {
    setRenamingId(item.id);
    setRenameDraft(item.name);
    setRenameError(null);
  };

  const submitRename = async (event: FormEvent, item: Branch | Department) => {
    event.preventDefault();
    const problem =
      validateName(renameDraft, "Name") ?? liveDuplicate(renameDraft, item.id);
    if (problem) {
      setRenameError(problem);
      return;
    }
    setBusy(true);
    try {
      const row = await renameOrg(kind, item.id, renameDraft);
      setRenamingId(null);
      onChanged(row.name === item.name ? "No change." : `Renamed to ${row.name}.`);
    } catch (err) {
      setRenameError(errorMessage(err));
    }
    setBusy(false);
  };

  const runConfirm = async () => {
    if (!confirm) return;
    try {
      if (confirm.action === "delete") {
        await deleteOrg(kind, confirm.item.id);
        setConfirm(null);
        onChanged(`${confirm.item.name} deleted.`);
        return;
      }
      const row = await setOrgActive(kind, confirm.item.id, confirm.action === "activate");
      setConfirm(null);
      onChanged(`${row.name} ${confirm.action === "activate" ? "activated" : "deactivated"}.`);
    } catch (err) {
      setConfirmError(errorMessage(err));
    }
  };

  /** Delete (departments) is only possible while nobody - active or former - is in it. */
  const deleteHint = (item: Branch | Department): string | null => {
    if (item.employee_count === 0) return null;
    const former = item.employee_count - item.active_employee_count;
    return `Move ${item.employee_count} employee${item.employee_count === 1 ? "" : "s"} first${former > 0 ? " (includes former staff)" : ""}`;
  };

  const affected = confirm?.item.active_employee_count ?? 0;

  return (
    <section className={`card ${styles.cardPad}`} aria-labelledby={`${kind}-title`}>
      <div className={styles.cardHead}>
        <div>
          <h2 id={`${kind}-title`} className={styles.cardTitle}>
            {title}
          </h2>
          <p className={styles.cardNote}>{note}</p>
        </div>
      </div>

      {error ? (
        <p className={`${styles.note} ${styles.noteDanger}`} role="alert">
          {errorMessage(error)}{" "}
          <button type="button" className={styles.ghost} onClick={onRetry}>
            Try again
          </button>
        </p>
      ) : null}

      <ul className={styles.list} aria-busy={loading || undefined}>
        {loading && list.length === 0 ? (
          <li className={`${styles.listItem} muted`}>Loading…</li>
        ) : null}
        {list.map((item) => (
          <li key={item.id} className={styles.listItem}>
            {renamingId === item.id ? (
              <form
                className={styles.inlineForm}
                onSubmit={(event) => void submitRename(event, item)}
                noValidate
              >
                <label htmlFor={`${kind}-rename-${item.id}`} className="sr-only">
                  New name for {item.name}
                </label>
                <input
                  id={`${kind}-rename-${item.id}`}
                  className={`input ${renameError ? styles.inputError : ""}`}
                  value={renameDraft}
                  onChange={(event) => {
                    setRenameDraft(event.target.value);
                    setRenameError(liveDuplicate(event.target.value, item.id));
                  }}
                  aria-invalid={renameError ? true : undefined}
                  aria-describedby={renameError ? `${kind}-rename-error-${item.id}` : undefined}
                  autoFocus
                  maxLength={120}
                />
                <button type="submit" className="btn btn--primary" disabled={busy}>
                  Save
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setRenamingId(null)}
                  disabled={busy}
                >
                  Cancel
                </button>
                {renameError ? (
                  <span
                    id={`${kind}-rename-error-${item.id}`}
                    className={styles.fieldError}
                    role="alert"
                    style={{ flexBasis: "100%" }}
                  >
                    {renameError}
                  </span>
                ) : null}
              </form>
            ) : (
              <>
                <span className={styles.listMain}>
                  <span className={styles.listName}>{item.name}</span>
                  <span className={styles.secondary}>{countText(item)}</span>
                </span>
                {kind === "branch" ? <Pill status={item.is_active ? "active" : "inactive"} /> : null}
                {canEdit ? (
                  <span className={styles.rowActions}>
                    <button
                      type="button"
                      className={styles.ghost}
                      onClick={() => startRename(item)}
                      aria-label={`Rename ${item.name}`}
                    >
                      Rename
                    </button>
                    {kind === "department" ? (
                      <button
                        type="button"
                        className={`${styles.ghost} ${styles.ghostDanger}`}
                        onClick={() => {
                          setConfirmError(null);
                          setConfirm({ item, action: "delete" });
                        }}
                        disabled={deleteHint(item) !== null}
                        title={deleteHint(item) ?? undefined}
                        aria-label={`Delete ${item.name}`}
                      >
                        Delete
                      </button>
                    ) : item.is_active ? (
                      <button
                        type="button"
                        className={`${styles.ghost} ${styles.ghostDanger}`}
                        onClick={() => setConfirm({ item, action: "deactivate" })}
                        aria-label={`Deactivate ${item.name}`}
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={styles.ghost}
                        onClick={() => setConfirm({ item, action: "activate" })}
                        aria-label={`Activate ${item.name}`}
                      >
                        Activate
                      </button>
                    )}
                    {kind === "department" && deleteHint(item) ? (
                      <span className={styles.secondary}>{deleteHint(item)}</span>
                    ) : null}
                  </span>
                ) : null}
              </>
            )}
          </li>
        ))}
        {!loading && list.length === 0 && !error ? (
          <li className={`${styles.listItem} muted`}>None yet.</li>
        ) : null}
      </ul>

      {canEdit && !adding ? (
        <div className={styles.addRow}>
          <button type="button" className={styles.ghost} onClick={() => setAdding(true)}>
            + {label.add}
          </button>
        </div>
      ) : null}

      {canEdit && adding ? (
        <form
          className={`${styles.inlineForm} ${styles.addRow}`}
          onSubmit={(e) => void submitAdd(e)}
          noValidate
        >
          <label htmlFor={`${kind}-new`} className="sr-only">
            New {label.one} name
          </label>
          <input
            id={`${kind}-new`}
            className={`input ${draftError ? styles.inputError : ""}`}
            placeholder={kind === "branch" ? "e.g. Pokhara branch" : "e.g. Delivery"}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setDraftError(liveDuplicate(event.target.value, null));
            }}
            aria-invalid={draftError ? true : undefined}
            aria-describedby={draftError ? `${kind}-new-error` : undefined}
            autoFocus
            maxLength={120}
          />
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "Adding…" : "Add"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setAdding(false);
              setDraft("");
              setDraftError(null);
            }}
            disabled={busy}
          >
            Cancel
          </button>
          {draftError ? (
            <span
              id={`${kind}-new-error`}
              className={styles.fieldError}
              role="alert"
              style={{ flexBasis: "100%" }}
            >
              {draftError}
            </span>
          ) : null}
        </form>
      ) : null}

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm?.action === "delete"
            ? `Delete ${label.one} ${confirm.item.name} permanently?`
            : confirm?.action === "activate"
              ? `Activate ${label.one}?`
              : `Deactivate ${label.one}?`
        }
        confirmLabel={confirm?.action === "delete" ? "Delete" : confirm?.action === "activate" ? "Activate" : "Deactivate"}
        danger={confirm?.action !== "activate"}
        onConfirm={runConfirm}
        onClose={() => setConfirm(null)}
      >
        {confirmError ? (
          <p className={`${styles.note} ${styles.noteDanger}`} role="alert">
            {confirmError}
          </p>
        ) : null}
        {confirm?.action === "delete" ? (
          <p>
            <strong>{confirm.item.name}</strong> is removed for good; it is not in any employee&apos;s record. This cannot be undone.
          </p>
        ) : confirm?.action === "activate" ? (
          <p>
            <strong>{confirm.item.name}</strong> will appear in pickers again.
          </p>
        ) : (
          <div className={styles.form}>
            {affected > 0 ? (
              <p className={`${styles.note} ${styles.noteWarn}`}>
                <strong>
                  {affected} active employee{affected === 1 ? "" : "s"}
                </strong>{" "}
                {affected === 1 ? "is" : "are"} still in {confirm?.item.name}. They keep their
                records; move them to another {label.one} from Employees.
              </p>
            ) : null}
            <p>
              <strong>{confirm?.item.name}</strong> disappears from dropdowns everywhere else but
              stays in history. You can activate it again later.
            </p>
          </div>
        )}
      </ConfirmDialog>
    </section>
  );
}
