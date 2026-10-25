"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";
import { UserFooter } from "@/components/UserFooter";
import type { Module, User } from "@/lib/api";
import styles from "./Sidebar.module.css";

export interface SidebarProps {
  user: User;
  /** "Admin · Main branch" under the name in the footer. */
  place: string;
  modules: Module[];
  onLogout: () => void;
}

export function isActivePath(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

function NavLink({
  href,
  icon,
  label,
  active,
}: {
  href: string;
  icon: string;
  label: string;
  active: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        className={styles.link}
        aria-current={active ? "page" : undefined}
      >
        <Icon name={icon} />
        {label}
      </Link>
    </li>
  );
}

/**
 * Sidebar (docs/design/Main.dc.html): brand block, the Dashboard link, then one
 * titled section per module from /api/core/modules - Attendance (Mark
 * attendance, Attendance report), People & payroll (Employees, Salary report,
 * Payment reports), Admin (Users, Barcodes, Payment modes). The backend has already
 * filtered the entries to the user's effective permissions and left out
 * modules with nothing visible, so a section never shows a placeholder link.
 * Beside the page it is sticky and exactly the viewport high: the links scroll
 * inside it and the footer (user + Log out) always stays at the bottom.
 */
export function Sidebar({ user, place, modules, onLogout }: SidebarProps) {
  const pathname = usePathname();
  const sections = modules.filter((module) => module.nav.length > 0);

  return (
    <nav className={styles.sidebar} aria-label="Main">
      <Link href="/" className={styles.brand}>
        <span className={styles.tile} aria-hidden="true">
          TT
        </span>
        <span className={styles.brandText}>
          <span className={styles.brandName}>TTK Attendance</span>
          <span className={styles.brandSub}>Attendance &amp; payroll</span>
        </span>
      </Link>

      <div className={styles.scroll}>
        <ul className={styles.list}>
          <NavLink
            href="/"
            icon="dashboard"
            label="Dashboard"
            active={pathname === "/"}
          />
        </ul>
        {sections.map((module) => (
          <Fragment key={module.name}>
            <div className={styles.sectionTitle} data-module={module.name}>
              {module.title}
            </div>
            <ul className={styles.list}>
              {module.nav.map((item) => (
                <NavLink
                  key={item.path}
                  href={item.path}
                  icon={item.icon}
                  label={item.label}
                  active={isActivePath(pathname, item.path)}
                />
              ))}
            </ul>
          </Fragment>
        ))}
      </div>

      <UserFooter user={user} place={place} onLogout={onLogout} />
    </nav>
  );
}
