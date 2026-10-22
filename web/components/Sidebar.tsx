"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";
import type { Module, User } from "@/lib/api";
import styles from "./Sidebar.module.css";

export interface SidebarProps {
  user: User;
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
 * Sidebar from docs/design/Main.dc.html: brand block, then one titled section
 * per module (registry order, only modules with visible nav items). The
 * Dashboard link is the first item of the first section, as in the design;
 * when the user can see no module at all it stands alone.
 */
export function Sidebar({ user, modules, onLogout }: SidebarProps) {
  const pathname = usePathname();
  const sections = modules.filter((module) => module.nav.length > 0);
  const dashboard = (
    <NavLink
      href="/"
      icon="dashboard"
      label="Dashboard"
      active={pathname === "/"}
    />
  );

  return (
    <nav className={styles.sidebar} aria-label="Main">
      <Link href="/" className={styles.brand}>
        <span className={styles.tile} aria-hidden="true">
          TT
        </span>
        <span className={styles.brandText}>
          <span className={styles.brandName}>TTK Stock</span>
          <span className={styles.brandSub}>Stock &amp; attendance</span>
        </span>
      </Link>

      {sections.length === 0 ? (
        <ul className={styles.list}>{dashboard}</ul>
      ) : (
        sections.map((module, index) => (
          <Fragment key={module.name}>
            <div className={styles.sectionTitle} data-module={module.name}>
              {module.title}
            </div>
            <ul className={styles.list}>
              {index === 0 ? dashboard : null}
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
        ))
      )}

      <div className={styles.footer}>
        <div className={styles.user}>
          <span className={styles.userName}>{user.full_name}</span>
          <span className={styles.userRole}>{user.role_label}</span>
        </div>
        <button type="button" className={styles.signOut} onClick={onLogout}>
          <Icon name="logout" size={16} />
          Sign out
        </button>
      </div>
    </nav>
  );
}
