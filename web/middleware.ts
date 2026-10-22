import { NextResponse, type NextRequest } from "next/server";

/** Name of the backend session cookie (HttpOnly, SameSite=Lax). */
export const SESSION_COOKIE = "ttk_session";

/**
 * Cheap first-line guard for app pages: when the session cookie is missing we
 * never render the shell, we go straight to the login page. The real check is
 * done by the API, every 401 it returns also sends the user to /login (see
 * lib/api.ts).
 */
export function middleware(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }
  const { pathname, search } = request.nextUrl;
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Everything except /login, Next internals, the API proxy, /health,
  // favicon.ico and any path that carries a file extension.
  matcher: [
    "/((?!login|_next|api|health|favicon\\.ico|.*\\.[^/]+$).*)",
  ],
};
