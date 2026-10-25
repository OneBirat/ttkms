"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/Modal";
import { AddDepartmentForm } from "./DepartmentForm";
import { BottomSheet } from "./phone/BottomSheet";
import { deleteDepartment, listDepartments, renameDepartment } from "../api";
import { cleanDepartmentName, countText, deleteConfirmText, deleteState, validateDepartmentName } from "../_lib/departments";
import { useIsPhone } from "../_lib/useIsPhone";
import { payrollErrorMessage, usePayroll } from "../_lib/usePayroll";
import type { Department } from "../types";
import styles from "./employees.module.css";
import shared from "./payroll.module.css";
import phone from "./phone/phone.module.css";

export interface ManageDepartmentsDialogProps {
  open: boolean;
  onClose: () => void;
  /** After any add / rename / delete (the mock store also broadcasts, so lists refresh by themselves). */
  onChanged?: () => void;
}

const TITLE = "Manage departments";

/**
 * Manage departments (design: modal on desktop, bottom sheet on phone): every department with
 * its employee count, inline Rename, Delete (only at 0 employees), and "+ Add department".
 * Only shown to users with manage_employees; the server checks again.
 */
export function ManageDepartmentsDialog({ open, onClose, onChanged }: ManageDepartmentsDialogProps) {
  const isPhone = useIsPhone();
  if (!open) return null;
  const body = <DepartmentsBody onChanged={onChanged} />;
  if (isPhone) {
    return (
      <BottomSheet open={open} label={TITLE} onClose={onClose}>
        <div className={phone.sheetHeader}>
          <h2 className={phone.sheetTitle} style={{ flex: 1 }}>
            {TITLE}
          </h2>
          <button type="button" className={phone.iconButton} aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        {body}
      </BottomSheet>
    );
  }
  return (
    <Modal open={open} title={TITLE} onClose={onClose} size="sm">
      {body}
    </Modal>
  );
}

function DepartmentsBody({ onChanged }: { onChanged?: () => void }) {
  const uid = useId();
  const departments = usePayroll(listDepartments, []);
  const list = departments.data ?? [];
  const [adding, setAdding] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const changed = (text: string) => {
    setToast({ text });
    departments.reload();
    onChanged?.();
  };

  const startRename = (d: Department) => {
    setConfirmId(null);
    setRenamingId(d.id);
    setRenameDraft(d.name);
    setRenameError(null);
  };

  const submitRename = async (event: FormEvent, d: Department) => {
    event.preventDefault();
    const clean = cleanDepartmentName(renameDraft);
    if (clean === d.name) {
      setRenamingId(null);
      return;
    }
    const problem = validateDepartmentName(renameDraft, list, d.id);
    if (problem) {
      setRenameError(problem);
      return;
    }
    setBusy(true);
    try {
      const row = await renameDepartment(d.id, clean);
      setRenamingId(null);
      changed(`${d.name} renamed to ${row.name}.`);
    } catch (err) {
      setRenameError(payrollErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d: Department) => {
    setBusy(true);
    try {
      await deleteDepartment(d.id);
      setConfirmId(null);
      changed(`${d.name} deleted.`);
    } catch (err) {
      setConfirmId(null);
      setToast({ text: payrollErrorMessage(err), error: true });
      departments.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={shared.stack} style={{ gap: 12 }}>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Departments group employees in lists, filters and reports. A department can be deleted once nobody is in it.
      </p>
      {toast ? (
        <div role="status" className={`${shared.toast} ${toast.error ? shared.toastError : ""}`}>
          {toast.text}
        </div>
      ) : null}
      {departments.error ? (
        <p className={shared.formError} role="alert">
          {payrollErrorMessage(departments.error)}{" "}
          <button type="button" className={shared.linkButton} onClick={departments.reload}>
            Try again
          </button>
        </p>
      ) : null}
      <ul className={styles.deptList} aria-label="Departments" aria-busy={departments.loading || undefined}>
        {departments.loading && list.length === 0 ? <li className={`${styles.deptRow} muted`}>Loading…</li> : null}
        {!departments.loading && list.length === 0 && !departments.error ? <li className={`${styles.deptRow} muted`}>No departments yet.</li> : null}
        {list.map((d) => {
          const del = deleteState(d);
          if (renamingId === d.id) {
            return (
              <li key={d.id} className={styles.deptRow}>
                <form className={styles.deptRename} onSubmit={(e) => void submitRename(e, d)} noValidate>
                  <label htmlFor={`${uid}-rename-${d.id}`} className={shared.srOnly}>
                    New name for {d.name}
                  </label>
                  <div className={`field ${renameError ? shared.fieldInvalid : ""}`} style={{ flex: "1 1 auto" }}>
                    <input
                      id={`${uid}-rename-${d.id}`}
                      value={renameDraft}
                      onChange={(e) => {
                        setRenameDraft(e.target.value);
                        if (renameError) setRenameError(null);
                      }}
                      maxLength={120}
                      autoFocus
                      aria-invalid={renameError ? true : undefined}
                      aria-describedby={renameError ? `${uid}-rename-error-${d.id}` : undefined}
                    />
                  </div>
                  <button type="submit" className="btn btn--primary" disabled={busy}>
                    Save
                  </button>
                  <button type="button" className="btn" onClick={() => setRenamingId(null)} disabled={busy}>
                    Cancel
                  </button>
                  {renameError ? (
                    <span id={`${uid}-rename-error-${d.id}`} className={shared.fieldError} role="alert" style={{ flexBasis: "100%" }}>
                      {renameError}
                    </span>
                  ) : null}
                </form>
              </li>
            );
          }
          if (confirmId === d.id) {
            return (
              <li key={d.id} className={`${styles.deptRow} ${styles.deptRowConfirm}`}>
                <span className={styles.deptRowText}>
                  <strong>{deleteConfirmText(d)}</strong>
                  <span className={styles.deptRowCount}>This cannot be undone.</span>
                </span>
                <span className={styles.deptRowActions}>
                  <button type="button" className="btn btn--danger" onClick={() => void remove(d)} disabled={busy}>
                    {busy ? "Deleting…" : "Delete"}
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirmId(null)} disabled={busy}>
                    Cancel
                  </button>
                </span>
              </li>
            );
          }
          return (
            <li key={d.id} className={styles.deptRow}>
              <span className={styles.deptRowText}>
                <span className={styles.deptRowName}>{d.name}</span>
                <span className={styles.deptRowCount}>{countText(d)}</span>
              </span>
              <span className={styles.deptRowActions}>
                <button type="button" className="btn btn--ghost" onClick={() => startRename(d)} aria-label={`Rename ${d.name}`}>
                  Rename
                </button>
                <span className={styles.deptDelete} title={del.hint ?? undefined}>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    data-tone="danger"
                    onClick={() => setConfirmId(d.id)}
                    disabled={!del.enabled}
                    aria-label={`Delete ${d.name}`}
                    aria-describedby={del.hint ? `${uid}-hint-${d.id}` : undefined}
                  >
                    Delete
                  </button>
                  {del.hint ? (
                    <span id={`${uid}-hint-${d.id}`} className={styles.deptHint}>
                      {del.hint}
                    </span>
                  ) : null}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {adding ? (
        <AddDepartmentForm
          id={`${uid}-new`}
          existing={list}
          onCreated={(d) => {
            setAdding(false);
            changed(`${d.name} added.`);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <div>
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            + Add department
          </button>
        </div>
      )}
    </div>
  );
}
