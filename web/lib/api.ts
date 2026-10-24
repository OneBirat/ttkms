/**
 * Typed client for the TTK JSON API.
 *
 * Every call goes to a same-origin /api/* path that next.config.ts proxies to
 * the FastAPI backend, so the HttpOnly session cookie travels automatically.
 * Unsafe methods carry the X-CSRF-Token header; the token lives in a
 * module-level store that is refreshed from every response carrying one.
 */

// ---------------------------------------------------------------- contract

export type Role = "admin" | "manager" | "store_keeper" | "staff";

export interface User {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  role_label: string;
  employee_id: number | null;
  last_login_at: string | null;
}

export interface AuthResponse {
  user: User;
  csrf_token: string;
}

export interface CsrfResponse {
  csrf_token: string;
}

export interface LoginRequest {
  username: string;
  password: string;
  remember: boolean;
}

export interface NavItem {
  label: string;
  path: string;
  icon: string;
  /** Only sent by /api/registry; /api/core/modules items are already role-filtered. */
  roles?: string[];
}

export interface Module {
  name: string;
  title: string;
  /** Already filtered to the current user's role; empty when nothing is allowed. */
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
 * the backend (a paused module such as "stock" is absent); `nav` is what the
 * sidebar renders, in sidebar order, filtered to the user's role.
 */
export interface ModulesResponse {
  enabled: string[];
  nav: NavSection[];
}

export type Tone = "ok" | "low" | "danger" | "leave" | "neutral";

export interface Stat {
  label: string;
  value: number;
  hint?: string | null;
  tone?: Tone | null;
  href?: string | null;
}

export interface Widget {
  module: string;
  kind: string;
  title: string;
  data: Record<string, unknown>;
}

export interface DashboardResponse {
  stats: Stat[];
  widgets: Widget[];
}

export interface TodayText {
  np: string;
  bs_en: string;
  ad: string;
  full: string;
}

export interface Today {
  ad: string;
  bs: string | null;
  /** False while the BS calendar table is not installed; only text.ad is set then. */
  available: boolean;
  text: TodayText;
}

export interface BsConvertResponse {
  ad: string;
  bs: string;
  bs_text: string;
  bs_text_np: string;
  weekday_np: string;
}

export type ModuleName = "stock" | "attendance" | "payroll" | "admin";

export interface ModulePlaceholderResponse {
  module: ModuleName;
  title: string;
  status: "coming_soon";
}

export interface ApiErrorBody {
  detail: string;
}

// ------------------------------------------------------------------ errors

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
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
    if (response.status === 401 && redirectOn401) {
      redirectToLogin();
    }
    throw new ApiError(
      response.status,
      detailFrom(parsed, response.statusText || `Request failed (${response.status})`),
    );
  }

  rememberCsrf(parsed);
  return parsed as T;
}
