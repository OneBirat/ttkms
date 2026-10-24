/**
 * Pure helpers over GET /api/core/modules. No React, no fetch: this file is
 * imported by middleware.ts (edge runtime) and by the unit tests, as well as by
 * the session provider and the login page.
 */

import type { Module, NavSection } from "./api";

/**
 * Which module owns a frontend path. The payroll module's pages live under
 * /people (its sidebar section is "People & payroll"). Unknown paths
 * (dashboard, module-off, ...) return null.
 */
const MODULE_ROUTES: ReadonlyArray<readonly [prefix: string, module: string]> = [
  ["/attendance", "attendance"],
  ["/people", "payroll"],
  ["/admin", "admin"],
];

/**
 * Pages that need no session and no module check: the phone photo-capture page
 * opens from a QR code / link carrying a one-off token, on a phone that is
 * not signed in (web/app/people/photo/[token]).
 */
const PUBLIC_ROUTES: readonly string[] = ["/people/photo"];

function underPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function moduleForPath(pathname: string): string | null {
  for (const [prefix, module] of MODULE_ROUTES) {
    if (underPrefix(pathname, prefix)) return module;
  }
  return null;
}

/** True for a page the middleware must let through without a session cookie. */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_ROUTES.some((prefix) => underPrefix(pathname, prefix));
}

/** The module registry shape the shell has always used, derived from the nav sections. */
export function modulesFromNav(nav: NavSection[]): Module[] {
  return nav.map((section) => ({
    name: section.module,
    title: section.title,
    nav: section.items,
    allowed: section.items.length > 0,
  }));
}

/**
 * Where a user lands after signing in (when the login URL carries no `next`):
 * the first link of the first module they may see (Mark attendance for most
 * users).
 */
export function homePath(nav: NavSection[]): string {
  for (const section of nav) {
    if (section.items.length > 0) return section.items[0].path;
  }
  return "/";
}

/** Dashboard widgets of a module that is not enabled are never rendered. */
export function enabledOnly<T extends { module: string }>(
  items: T[],
  enabled: string[],
): T[] {
  return items.filter((item) => enabled.includes(item.module));
}
