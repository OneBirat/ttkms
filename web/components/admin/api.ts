/**
 * Admin API client - MOCK EDITION for Settings and the Audit log (their
 * endpoints do not exist yet). Users, payment modes and barcodes use the real
 * API (usersApi.ts, paymentModesApi.ts, barcodesApi.ts), and so do branches
 * and departments (/api/core/branches, /api/core/departments).
 *
 * State lives in memory, seeded from ./mock/data; every mutation applies the
 * rules the backend will enforce (unique names, no deleting referenced rows)
 * and appends an audit entry.
 */

import { ApiError, apiFetch } from "@/lib/api";
import { validateName } from "./names";
import { changedGroups, validateSettings } from "./settingsValidation";
import {
  approxAd,
  approxBs,
  AUDIT,
  SETTINGS,
} from "./mock/data";
import type {
  AuditActor,
  AuditEntry,
  AuditListParams,
  AuditValues,
  Branch,
  Department,
  OrgKind,
  Page,
  Settings,
  SettingsInput,
} from "./types";

// ------------------------------------------------------------ mock state

const LATENCY_MS = 160;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const state = {
  settings: clone(SETTINGS),
  audit: clone(AUDIT),
  nextAuditId: Math.max(...AUDIT.map((a) => a.id)) + 1,
};

let actor: AuditActor = { id: 1, username: "admin", full_name: "Admin" };

/** Mock only: who the fake audit entries are attributed to (the real API reads the session). */
export function setMockActor(user: AuditActor): void {
  actor = { id: user.id, username: user.username, full_name: user.full_name };
}

function respond<T>(value: T): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(clone(value)), LATENCY_MS);
  });
}

function fail(status: number, detail: string): never {
  throw new ApiError(status, detail);
}

function nowIso(): string {
  return new Date().toISOString();
}

function recordAudit(
  action: string,
  entity: string,
  entityId: string | number | null,
  before: AuditValues | null,
  after: AuditValues | null,
): AuditEntry {
  const when = nowIso();
  const entry: AuditEntry = {
    id: state.nextAuditId++,
    at: when,
    at_bs: approxBs(when),
    user: { ...actor },
    module: "admin",
    action,
    entity,
    entity_id: entityId === null ? null : String(entityId),
    before,
    after,
  };
  state.audit.unshift(entry);
  return entry;
}

// ------------------------------------------- branches & departments (real, /api/core)

/** One row of GET /api/core/departments (app/core/schemas.py DepartmentOut). */
interface DepartmentRow {
  id: number;
  name: string;
  employee_count: number;
  active_employee_count: number;
}

/** core.departments.is_active exists but the API ignores it: a department is listed until deleted. */
function departmentOf(row: DepartmentRow): Department {
  return { ...row, is_active: true };
}

function orgLabel(kind: OrgKind): string {
  return kind === "branch" ? "Branch" : "Department";
}

/** GET /api/core/branches - every branch A-Z with employee counts (former staff included). */
export async function listBranches(): Promise<Branch[]> {
  return apiFetch<Branch[]>("/api/core/branches");
}

/** GET /api/core/departments - real; counts include former staff. */
export async function listDepartments(): Promise<Department[]> {
  const rows = await apiFetch<DepartmentRow[]>("/api/core/departments");
  return rows.map(departmentOf);
}

/** DELETE /api/core/departments/{id} - real; 409 department_in_use while anyone references it. */
export async function deleteOrg(kind: OrgKind, id: number): Promise<void> {
  if (kind !== "department") fail(405, "Branches are deactivated, not deleted.");
  await apiFetch<void>(`/api/core/departments/${id}`, { method: "DELETE" });
}

/** POST /api/core/branches | /api/core/departments {name} -> 201 (409 duplicate_name); the server audits. */
export async function createOrg(kind: OrgKind, name: string): Promise<Branch | Department> {
  const clean = name.replace(/\s+/g, " ").trim();
  const error = validateName(clean, orgLabel(kind) + " name");
  if (error) fail(422, error);
  if (kind === "department") {
    return departmentOf(await apiFetch<DepartmentRow>("/api/core/departments", { method: "POST", json: { name: clean } }));
  }
  return apiFetch<Branch>("/api/core/branches", { method: "POST", json: { name: clean } });
}

/** PATCH /api/core/branches/{id} | /api/core/departments/{id} {name} (409 duplicate_name). */
export async function renameOrg(
  kind: OrgKind,
  id: number,
  name: string,
): Promise<Branch | Department> {
  const clean = name.replace(/\s+/g, " ").trim();
  const error = validateName(clean, orgLabel(kind) + " name");
  if (error) fail(422, error);
  if (kind === "department") {
    return departmentOf(await apiFetch<DepartmentRow>(`/api/core/departments/${id}`, { method: "PATCH", json: { name: clean } }));
  }
  return apiFetch<Branch>(`/api/core/branches/${id}`, { method: "PATCH", json: { name: clean } });
}

/** PATCH /api/core/branches/{id} {is_active} (409 last_active_branch). */
export async function setOrgActive(
  kind: OrgKind,
  id: number,
  active: boolean,
): Promise<Branch | Department> {
  if (kind === "department") fail(405, "Departments are deleted, not deactivated.");
  return apiFetch<Branch>(`/api/core/branches/${id}`, { method: "PATCH", json: { is_active: active } });
}

// -------------------------------------------------------------- settings

export async function getSettings(): Promise<Settings> {
  return respond(state.settings);
}

function settingsInputOf(settings: Settings): SettingsInput {
  const { logo_url: _logo, ...company } = settings.company;
  void _logo;
  return {
    company,
    attendance: settings.attendance,
    payroll: settings.payroll,
    display: settings.display,
  };
}

export async function updateSettings(input: SettingsInput): Promise<Settings> {
  const errors = validateSettings(input);
  const firstError = Object.values(errors)[0];
  if (firstError) fail(422, firstError);
  const current = settingsInputOf(state.settings);
  const groups = changedGroups(current, input);
  const when = nowIso();
  for (const group of groups) {
    recordAudit(
      "update",
      "settings",
      group,
      clone(current[group]) as AuditValues,
      clone(input[group]) as AuditValues,
    );
    state.settings.meta[group] = {
      updated_by: actor.full_name,
      updated_at: when,
      updated_at_bs: approxBs(when),
    };
  }
  state.settings = {
    ...state.settings,
    company: { ...input.company, logo_url: state.settings.company.logo_url },
    attendance: clone(input.attendance),
    payroll: clone(input.payroll),
    display: clone(input.display),
  };
  return respond(state.settings);
}

const LOGO_MAX_BYTES = 512 * 1024;

export async function uploadLogo(file: File): Promise<Settings> {
  if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(file.type)) {
    fail(422, "Use a PNG, JPG, WebP or SVG image.");
  }
  if (file.size > LOGO_MAX_BYTES) fail(422, "Logo must be 512 KB or smaller.");
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ApiError(422, "Could not read the file."));
    reader.readAsDataURL(file);
  });
  const before = { logo: state.settings.company.logo_url ? "set" : null };
  state.settings.company.logo_url = url;
  const when = nowIso();
  state.settings.meta.company = {
    updated_by: actor.full_name,
    updated_at: when,
    updated_at_bs: approxBs(when),
  };
  recordAudit("update", "settings", "company", before, { logo: file.name });
  return respond(state.settings);
}

export async function removeLogo(): Promise<Settings> {
  if (!state.settings.company.logo_url) return respond(state.settings);
  state.settings.company.logo_url = null;
  const when = nowIso();
  state.settings.meta.company = {
    updated_by: actor.full_name,
    updated_at: when,
    updated_at_bs: approxBs(when),
  };
  recordAudit("update", "settings", "company", { logo: "set" }, { logo: null });
  return respond(state.settings);
}

// ----------------------------------------------------------------- audit

const AUDIT_PAGE_SIZE = 20;

function auditMatches(entry: AuditEntry, params: AuditListParams): boolean {
  if (params.module && entry.module !== params.module) return false;
  if (params.user_id && entry.user?.id !== params.user_id) return false;
  if (params.from_bs && entry.at_bs < params.from_bs) return false;
  if (params.to_bs && entry.at_bs > params.to_bs) return false;
  const q = (params.q ?? "").trim().toLowerCase();
  if (q) {
    const hay = [
      entry.action,
      entry.entity,
      entry.entity_id ?? "",
      entry.user?.full_name ?? "",
      entry.user?.username ?? "",
      JSON.stringify(entry.before ?? {}),
      JSON.stringify(entry.after ?? {}),
    ]
      .join(" ")
      .toLowerCase();
    if (!q.split(/\s+/).every((word) => hay.includes(word))) return false;
  }
  return true;
}

export async function listAudit(params: AuditListParams = {}): Promise<Page<AuditEntry>> {
  if (params.from_bs && approxAd(params.from_bs) === null) fail(422, "From date is not a valid BS date.");
  if (params.to_bs && approxAd(params.to_bs) === null) fail(422, "To date is not a valid BS date.");
  const page_size = params.page_size ?? AUDIT_PAGE_SIZE;
  const rows = state.audit.filter((entry) => auditMatches(entry, params));
  const pages = Math.max(1, Math.ceil(rows.length / page_size));
  const page = Math.min(Math.max(params.page ?? 1, 1), pages);
  const start = (page - 1) * page_size;
  return respond({
    items: rows.slice(start, start + page_size),
    total: rows.length,
    page,
    page_size,
    pages,
  });
}

/** Users who appear in the log, for the User filter. */
export async function listAuditUsers(): Promise<AuditActor[]> {
  const seen = new Map<number, AuditActor>();
  for (const entry of state.audit) {
    if (entry.user && !seen.has(entry.user.id)) seen.set(entry.user.id, entry.user);
  }
  return respond([...seen.values()].sort((a, b) => a.full_name.localeCompare(b.full_name)));
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Mock export: CSV of every matching row (Excel opens it). The real endpoint
 * is GET /api/admin/audit/export.xlsx built with app/core/export.py.
 */
export async function exportAudit(params: AuditListParams = {}): Promise<Blob> {
  const rows = state.audit.filter((entry) => auditMatches(entry, params));
  const header = ["When (BS)", "When (AD)", "User", "Module", "Action", "Entity", "ID", "Before", "After"];
  const lines = [header.join(",")];
  for (const entry of rows) {
    lines.push(
      [
        entry.at_bs,
        entry.at,
        entry.user ? `${entry.user.full_name} (${entry.user.username})` : "System",
        entry.module,
        entry.action,
        entry.entity,
        entry.entity_id,
        entry.before ? JSON.stringify(entry.before) : "",
        entry.after ? JSON.stringify(entry.after) : "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  await respond(null);
  return new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
}
