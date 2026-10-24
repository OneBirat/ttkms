/**
 * Typed client for the TTK JSON API.
 *
 * Every call goes to a same-origin /api/* path that next.config.ts proxies to
 * the FastAPI backend, so the HttpOnly session cookie travels automatically.
 * Unsafe methods carry the X-CSRF-Token header; the token lives in a
 * module-level store that is refreshed from every response carrying one.
 */

// ---------------------------------------------------------------- contract

export type Role = "admin" | "manager" | "staff";

export interface User {
  id: number;
  username: string;
  /** Login phone number (10 digits) when set; staff usually sign in with it. */
  phone: string | null;
  full_name: string;
  role: Role;
  role_label: string;
  employee_id: number | null;
  last_login_at: string | null;
  /** True until the user replaces the temporary password an admin gave them. */
  must_change_password: boolean;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}

/** The six per-user switches of app/modules/admin/permissions.py. */
export type Permission =
  | "mark_attendance"
  | "view_attendance_report"
  | "see_other_branches"
  | "manage_employees"
  | "salary_advances"
  | "manage_users";

/** Effective access: role preset + per-user overrides, every key present. */
export type Access = Partial<Record<Permission, boolean>>;

/**
 * POST /api/auth/login, GET /api/auth/me, POST /api/auth/change-password
 * (app/core/schemas.py SessionOut).
 */
export interface AuthResponse {
  user: User;
  csrf_token: string;
  /** The user's own branch (admin.user_access.branch_id); null for admins and unassigned users. */
  branch_id: number | null;
  access: Access;
}

export interface CsrfResponse {
  csrf_token: string;
}

export interface LoginRequest {
  /** Phone number or username. */
  username: string;
  password: string;
  remember: boolean;
}

export interface NavItem {
  label: string;
  path: string;
  icon: string;
  /** Only sent by /api/registry; /api/core/modules items are already filtered to the user. */
  roles?: string[];
  /** The permission that unlocks the entry (null = none needed). Only sent by /api/registry. */
  permission?: string | null;
}

export interface Module {
  name: string;
  title: string;
  /** Already filtered to the current user's permissions; empty when nothing is allowed. */
  nav: NavItem[];
  allowed: boolean;
}

export interface RegistryResponse {
  modules: Module[];
}

/** One sidebar section from GET /api/core/modules: an enabled module the user may see. */
export interface NavSection {
  module: string;
  title: string;
  items: NavItem[];
}

/**
 * GET /api/core/modules. `enabled` is the ENABLED_MODULES setting as loaded by
 * the backend (a paused module is absent); `nav` is what the sidebar renders,
 * in sidebar order, filtered to the user's effective permissions.
 */
export interface ModulesResponse {
  enabled: string[];
  nav: NavSection[];
}

export type Tone = "ok" | "low" | "danger" | "leave" | "neutral";

export interface Widget {
  module: string;
  kind: string;
  title: string;
  data: Record<string, unknown>;
}

/** GET /api/dashboard: the enabled modules' cards ("Attendance today", "Payments today"). */
export interface DashboardResponse {
  widgets: Widget[];
}

export interface TodayText {
  np: string;
  bs_en: string;
  ad: string;
  full: string;
}

/**
 * Today's headline numbers for the dashboard stat row (app/core/schemas.py
 * TodayCountsOut). A field is null when its module is not enabled. Scope: the
 * caller's branch, or every branch with `see_other_branches`.
 */
export interface TodayCounts {
  /** Active employees in scope. */
  total: number | null;
  /** Marked P. */
  present: number | null;
  /** Marked O (present with overtime). */
  overtime: number | null;
  overtime_hours: number | null;
  absent: number | null;
  not_marked: number | null;
  /** Rupees paid today (salary + advances). */
  paid_today: number | null;
  payments_today: number | null;
}

/** GET /api/today: today in Asia/Kathmandu, both calendars (app/core/schemas.py TodayOut). */
export interface Today {
  /** AD "YYYY-MM-DD". */
  date: string;
  /** BS "YYYY-MM-DD". */
  date_bs: string;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** "2083/84" */
  fiscal_year: string;
  text: TodayText;
  /** Only for a signed-in caller; null on the public (anonymous) answer. */
  counts: TodayCounts | null;
}

/** GET /api/bsdate/convert?date= | ?date_bs= */
export interface BsConvertResponse extends Omit<Today, "text"> {
  bs_text: string;
  bs_text_np: string;
  weekday_np: string;
}

export type ModuleName = "attendance" | "payroll" | "admin";

/** GET /api/<module>: the module's index endpoint. */
export interface ModuleStatusResponse {
  module: ModuleName;
  title: string;
  status: "coming_soon" | "ready";
}

export interface ApiErrorBody {
  detail: string;
  /** Machine-readable reason, e.g. "password_change_required". */
  code?: string;
}

/** 403 body code sent while the user still has a temporary password. */
export const PASSWORD_CHANGE_REQUIRED = "password_change_required";
export const SET_PASSWORD_PATH = "/set-password";

// ------------------------------------------------------------------ errors

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;
  readonly code: string | null;

  constructor(status: number, detail: string, code: string | null = null) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.code = code;
  }
}

/** True for a request cancelled through an AbortSignal. */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Human-readable message for anything thrown by apiFetch. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong.";
}

// -------------------------------------------------------------- csrf store

let csrfToken: string | null = null;
let csrfRequest: Promise<string> | null = null;

export function getCsrfToken(): string | null {
  return csrfToken;
}

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

/**
 * Returns the current CSRF token, fetching one from GET /api/auth/csrf when
 * the store is empty (that call also establishes the session cookie).
 * Pass `force` to always fetch a fresh token.
 */
export async function ensureCsrf(force = false): Promise<string> {
  if (csrfToken && !force) return csrfToken;
  if (!csrfRequest) {
    csrfRequest = apiFetch<CsrfResponse>("/api/auth/csrf", {
      redirectOn401: false,
    })
      .then((body) => body.csrf_token)
      .finally(() => {
        csrfRequest = null;
      });
  }
  return csrfRequest;
}

function rememberCsrf(body: unknown): void {
  if (
    body &&
    typeof body === "object" &&
    "csrf_token" in body &&
    typeof (body as { csrf_token: unknown }).csrf_token === "string"
  ) {
    csrfToken = (body as { csrf_token: string }).csrf_token;
  }
}

// ------------------------------------------------------------------- fetch

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface ApiFetchInit extends Omit<RequestInit, "body"> {
  /** Serialised as the JSON request body. */
  json?: unknown;
  /** Raw body; prefer `json`. */
  body?: BodyInit | null;
  /** Send the user to /login on 401 (default true; off on the login page). */
  redirectOn401?: boolean;
}

export function loginPath(nextPath?: string): string {
  const next =
    nextPath ??
    (typeof window === "undefined"
      ? "/"
      : `${window.location.pathname}${window.location.search}`);
  return next && next !== "/" ? `/login?next=${encodeURIComponent(next)}` : "/login";
}

/**
 * Validates a `next` query value for the post-login redirect: only same-site
 * paths ("/..." but not "//host" or backslash tricks) are accepted.
 */
export function safeNextPath(value: string | null): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  return value;
}

function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname.startsWith("/login")) return;
  window.location.assign(loginPath());
}

function codeFrom(body: unknown): string | null {
  if (body && typeof body === "object" && "code" in body) {
    const code = (body as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
}

/** Send the user to the "set your password" page (once; not from that page itself). */
function redirectToSetPassword(): void {
  if (typeof window === "undefined") return;
  if (window.location.pathname.startsWith(SET_PASSWORD_PATH)) return;
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`${SET_PASSWORD_PATH}?next=${encodeURIComponent(next)}`);
}

function detailFrom(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    // FastAPI validation errors: [{loc, msg, type}, ...]
    if (Array.isArray(detail)) {
      const messages = detail
        .map((item) =>
          item && typeof item === "object" && "msg" in item
            ? String((item as { msg: unknown }).msg)
            : "",
        )
        .filter(Boolean);
      if (messages.length) return messages.join(" ");
    }
  }
  return fallback;
}

/**
 * Fetch `path` and return its JSON body typed as T. Throws ApiError for any
 * non-2xx response (status + detail from the JSON error body) and the raw
 * fetch error when the server is unreachable.
 */
export async function apiFetch<T>(
  path: string,
  init: ApiFetchInit = {},
): Promise<T> {
  const { json, redirectOn401 = true, headers: initHeaders, ...rest } = init;
  const method = (rest.method ?? "GET").toUpperCase();
  const headers = new Headers(initHeaders);
  headers.set("Accept", "application/json");

  let body = rest.body ?? null;
  if (json !== undefined) {
    body = JSON.stringify(json);
    headers.set("Content-Type", "application/json");
  }

  if (!SAFE_METHODS.has(method)) {
    headers.set("X-CSRF-Token", await ensureCsrf());
  }

  const response = await fetch(path, {
    ...rest,
    method,
    headers,
    body,
    credentials: "same-origin",
    cache: "no-store",
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const code = codeFrom(parsed);
    if (response.status === 401 && redirectOn401) {
      redirectToLogin();
    } else if (response.status === 403 && code === PASSWORD_CHANGE_REQUIRED) {
      redirectToSetPassword();
    }
    throw new ApiError(
      response.status,
      detailFrom(parsed, response.statusText || `Request failed (${response.status})`),
      code,
    );
  }

  rememberCsrf(parsed);
  return parsed as T;
}
