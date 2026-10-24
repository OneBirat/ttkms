import { NextResponse, type NextRequest } from "next/server";
import type { ModulesResponse } from "@/lib/api";
import { isPublicPath, moduleForPath } from "@/lib/modules";

/** Name of the backend session cookie (HttpOnly, SameSite=Lax). */
export const SESSION_COOKIE = "ttk_session";

/** Origin of the FastAPI backend, the same value next.config.ts proxies to. */
const API_URL = process.env.API_URL ?? "http://localhost:8000";

/**
 * Is the module that owns this page enabled on the backend (ENABLED_MODULES)?
 * Asked only for pages a module owns, with the visitor's own session cookie,
 * so the answer is exactly what the sidebar shows them. Fails open: when the
 * backend cannot be reached, or the session is invalid, the page renders and
 * its own API calls report the real problem (or send the user to /login).
 */
async function moduleEnabled(
  name: string,
  request: NextRequest,
): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/api/core/modules`, {
      headers: {
        Accept: "application/json",
        Cookie: request.headers.get("cookie") ?? "",
      },
      cache: "no-store",
    });
    if (!response.ok) return true;
    const body = (await response.json()) as ModulesResponse;
    return body.enabled.includes(name);
  } catch {
    return true;
  }
}

/**
 * First-line guard for app pages.
 *
 * 0. Public pages (the token-protected phone photo page under /people/photo)
 *    pass straight through: no session, no module check.
 * 1. No session cookie: never render the shell, go straight to the login page.
 *    The real check is done by the API, every 401 it returns also sends the
 *    user to /login (see lib/api.ts).
 * 2. A page owned by a module that is not in the backend's ENABLED_MODULES
 *    (/attendance/**, /people/**, /admin/**): send the user to the "module
 *    turned off" page. The page files stay in the repo; this is what makes
 *    them unreachable.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  if (!request.cookies.has(SESSION_COOKIE)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  const owner = moduleForPath(pathname);
  if (owner && !(await moduleEnabled(owner, request))) {
    const offUrl = request.nextUrl.clone();
    offUrl.pathname = "/module-off";
    offUrl.search = "";
    offUrl.searchParams.set("module", owner);
    return NextResponse.redirect(offUrl);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except /login, Next internals, the API proxy, /health,
  // favicon.ico and any path that carries a file extension.
  matcher: [
    "/((?!login|_next|api|health|favicon\\.ico|.*\\.[^/]+$).*)",
  ],
};
