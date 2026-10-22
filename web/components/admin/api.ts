/**
 * Admin API client - MOCK EDITION.
 *
 * Pages call only the functions exported here. For now they resolve against
 * in-memory state seeded from ./mock/data; every mutation applies the same
 * rules the backend will enforce (unique names, last-admin protection) and
 * appends an audit entry. The next session replaces the bodies with
 * `apiFetch("/api/admin/...")` calls without touching the pages.
 */

import { ApiError } from "@/lib/api";
import {
  canDeactivate,
  canChangeRole,
} from "./guards";
import {
  findDuplicateName,
  findDuplicateUsername,
  normalizeUsername,
  validateName,
  validateUsername,
} from "./names";
import { ROLE_LABELS } from "./permissions";
import { changedGroups, validateSettings } from "./settingsValidation";
import {
  approxAd,
  approxBs,
  AUDIT,
  BRANCHES,
  DEPARTMENTS,
  EMPLOYEE_DEPARTMENT_IDS,
  EMPLOYEES,
  SETTINGS,
  USERS,
} from "./mock/data";
import type {
  AdminUser,
  AuditActor,
  AuditEntry,
  AuditListParams,
  AuditValues,
  Branch,
  Department,
  EmployeeRef,
  OneTimePassword,
  OrgKind,
  Page,
  Settings,
  SettingsInput,
  UserCreated,
  UserInput,
  UserListParams,
} from "./types";

// ------------------------------------------------------------ mock state

const LATENCY_MS = 160;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const state = {
  users: clone(USERS),
  branches: clone(BRANCHES),
  departments: clone(DEPARTMENTS),
  employees: clone(EMPLOYEES),
  settings: clone(SETTINGS),
  audit: clone(AUDIT),
  nextUserId: Math.max(...USERS.map((u) => u.id)) + 1,
  nextOrgId: 100,
  nextAuditId: Math.max(...AUDIT.map((a) => a.id)) + 1,
};

let actor: AuditActor = { id: 1, username: "admin", full_name: "Admin" };

/** Mock only: tell the fake API who is signed in (the real one reads the session). */
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

function recomputeCounts(): void {
  for (const branch of state.branches) {
    const members = state.employees.filter((e) => e.branch_id === branch.id);
    branch.employee_count = members.length;
    branch.active_employee_count = members.filter((e) => e.status === "active").length;
  }
  for (const department of state.departments) {
    const members = state.employees.filter(
      (e) => EMPLOYEE_DEPARTMENT_IDS[e.id] === department.id,
    );
    department.employee_count = members.length;
    department.active_employee_count = members.filter((e) => e.status === "active").length;
  }
}
recomputeCounts();

// ------------------------------------------------------------- employees

export async function listEmployees(): Promise<EmployeeRef[]> {
  return respond(state.employees);
}

// ----------------------------------------------------------------- users

function userSnapshot(user: AdminUser): AuditValues {
  return {
    full_name: user.full_name,
    username: user.username,
    role: user.role,
    employee: user.employee?.code ?? null,
    branches: user.branch_ids.length
      ? user.branch_ids.map((id) => state.branches.find((b) => b.id === id)?.name ?? id)
      : "all",
    is_active: user.is_active,
  };
}

const OTP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

function generateOneTimePassword(): string {
  const bytes = new Uint8Array(12);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  const chars = Array.from(bytes, (b) => OTP_ALPHABET[b % OTP_ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8).join("")}`;
}

function validateUserInput(input: UserInput, ignoreId: number | null): UserInput {
  const full_name = input.full_name.replace(/\s+/g, " ").trim();
  const nameError = validateName(full_name, "Full name");
  if (nameError) fail(422, nameError);
  const usernameError = validateUsername(input.username);
  if (usernameError) fail(422, usernameError);
  const username = normalizeUsername(input.username);
  if (findDuplicateUsername(state.users, username, ignoreId)) {
    fail(409, `Username "${username}" is already taken.`);
  }
  if (input.employee_id !== null) {
    const employee = state.employees.find((e) => e.id === input.employee_id);
    if (!employee) fail(422, "Linked employee not found.");
    const owner = state.users.find(
      (u) => u.employee?.id === input.employee_id && u.id !== ignoreId,
    );
    if (owner) fail(409, `${employee.full_name} is already linked to ${owner.username}.`);
  }
  for (const id of input.branch_ids) {
    const branch = state.branches.find((b) => b.id === id);
    if (!branch) fail(422, "Unknown branch.");
    if (!branch.is_active) fail(422, `${branch.name} is deactivated.`);
  }
  return { ...input, full_name, username, branch_ids: [...new Set(input.branch_ids)].sort() };
}

export async function listUsers(params: UserListParams = {}): Promise<AdminUser[]> {
  const q = (params.q ?? "").trim().toLowerCase();
  const status = params.status ?? "all";
  const rows = state.users.filter((user) => {
    if (params.role && user.role !== params.role) return false;
    if (status === "active" && !user.is_active) return false;
    if (status === "inactive" && user.is_active) return false;
    if (q) {
      const hay = `${user.full_name} ${user.username} ${user.employee?.code ?? ""}`.toLowerCase();
      if (!q.split(/\s+/).every((word) => hay.includes(word))) return false;
    }
    return true;
  });
  return respond(rows);
}

export async function createUser(input: UserInput): Promise<UserCreated> {
  const clean = validateUserInput(input, null);
  const user: AdminUser = {
    id: state.nextUserId++,
    username: clean.username,
    full_name: clean.full_name,
    role: clean.role,
    role_label: ROLE_LABELS[clean.role],
    is_active: clean.is_active,
    employee: state.employees.find((e) => e.id === clean.employee_id) ?? null,
    branch_ids: clean.branch_ids,
    last_login_at: null,
    last_login_at_bs: null,
    created_at: nowIso(),
  };
  state.users.push(user);
  recordAudit("create", "user", user.id, null, userSnapshot(user));
  const one_time_password: OneTimePassword = {
    user_id: user.id,
    username: user.username,
    password: generateOneTimePassword(),
  };
  return respond({ user, one_time_password });
}

export async function updateUser(id: number, input: UserInput): Promise<AdminUser> {
  const user = state.users.find((u) => u.id === id);
  if (!user) fail(404, "User not found.");
  const clean = validateUserInput(input, id);
  const roleBlock = canChangeRole(state.users, user, clean.role, actor.id);
  if (roleBlock) fail(409, roleBlock);
  if (user.is_active && !clean.is_active) {
    const block = canDeactivate(state.users, { ...user, role: clean.role }, actor.id);
    if (block) fail(409, block);
  }
  const before = userSnapshot(user);
  user.full_name = clean.full_name;
  user.username = clean.username;
  user.role = clean.role;
  user.role_label = ROLE_LABELS[clean.role];
  user.employee = state.employees.find((e) => e.id === clean.employee_id) ?? null;
  user.branch_ids = clean.branch_ids;
  user.is_active = clean.is_active;
  recordAudit("update", "user", user.id, before, userSnapshot(user));
  return respond(user);
}

export async function setUserActive(id: number, active: boolean): Promise<AdminUser> {
  const user = state.users.find((u) => u.id === id);
  if (!user) fail(404, "User not found.");
  if (user.is_active === active) return respond(user);
  if (!active) {
    const block = canDeactivate(state.users, user, actor.id);
    if (block) fail(409, block);
  }
  const before = { is_active: user.is_active };
  user.is_active = active;
  recordAudit(active ? "activate" : "deactivate", "user", user.id, before, {
    is_active: active,
  });
  return respond(user);
}

export async function resetPassword(id: number): Promise<OneTimePassword> {
  const user = state.users.find((u) => u.id === id);
  if (!user) fail(404, "User not found.");
  recordAudit("reset_password", "user", user.id, null, { username: user.username });
  return respond({ user_id: user.id, username: user.username, password: generateOneTimePassword() });
}

// -------------------------------------------------- branches & departments

function orgList(kind: OrgKind): (Branch | Department)[] {
  return kind === "branch" ? state.branches : state.departments;
}

function orgLabel(kind: OrgKind): string {
  return kind === "branch" ? "Branch" : "Department";
}

export async function listBranches(): Promise<Branch[]> {
  recomputeCounts();
  return respond(state.branches);
}

export async function listDepartments(): Promise<Department[]> {
  recomputeCounts();
  return respond(state.departments);
}

export async function createOrg(kind: OrgKind, name: string): Promise<Branch | Department> {
  const clean = name.replace(/\s+/g, " ").trim();
  const error = validateName(clean, orgLabel(kind) + " name");
  if (error) fail(422, error);
  const list = orgList(kind);
  const duplicate = findDuplicateName(list, clean);
  if (duplicate) fail(409, `${orgLabel(kind)} "${duplicate.name}" already exists.`);
  const row = {
    id: state.nextOrgId++,
    name: clean,
    is_active: true,
    employee_count: 0,
    active_employee_count: 0,
  };
  list.push(row);
  recordAudit("create", kind, row.id, null, { name: row.name });
  return respond(row);
}

export async function renameOrg(
  kind: OrgKind,
  id: number,
  name: string,
): Promise<Branch | Department> {
  const list = orgList(kind);
  const row = list.find((r) => r.id === id);
  if (!row) fail(404, `${orgLabel(kind)} not found.`);
  const clean = name.replace(/\s+/g, " ").trim();
  const error = validateName(clean, orgLabel(kind) + " name");
  if (error) fail(422, error);
  const duplicate = findDuplicateName(list, clean, id);
  if (duplicate) fail(409, `${orgLabel(kind)} "${duplicate.name}" already exists.`);
  if (row.name === clean) return respond(row);
  const before = { name: row.name };
  row.name = clean;
  recordAudit("rename", kind, row.id, before, { name: row.name });
  return respond(row);
}

export async function setOrgActive(
  kind: OrgKind,
  id: number,
  active: boolean,
): Promise<Branch | Department> {
  const list = orgList(kind);
  const row = list.find((r) => r.id === id);
  if (!row) fail(404, `${orgLabel(kind)} not found.`);
  if (row.is_active === active) return respond(row);
  if (!active && list.filter((r) => r.is_active).length <= 1) {
    fail(409, `At least one active ${kind} is needed.`);
  }
  row.is_active = active;
  recordAudit(active ? "activate" : "deactivate", kind, row.id, { is_active: !active }, {
    is_active: active,
    affected_employees: active ? 0 : row.active_employee_count,
  });
  return respond(row);
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
    stock: settings.stock,
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
    stock: clone(input.stock),
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
