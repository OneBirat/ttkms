"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";
import type { Module, User } from "@/lib/api";
import styles from "./Sidebar.module.css";

export interface SidebarProps {
  user: User;
  modules: Module[];
}

export function isActivePath(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

function NavLink({
  href,
  icon,
  label,
  active,
  onNavigate,
}: {
  href: string;
  icon: string;
  label: string;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      className={styles.link}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
    >
      <Icon name={icon} />
      <span>{label}</span>
    </Link>
  );
}

export function Sidebar({ user, modules }: SidebarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const sections = modules.filter((module) => module.nav.length > 0);

  return (
    <aside className={styles.sidebar}>
      <div className={styles.top}>
        <Link href="/" className={styles.brand} onClick={close}>
          <span className={styles.tile} aria-hidden="true">
            TT
          </span>
          <span className={styles.brandText}>
            <span className={styles.brandName}>TTK Stock</span>
            <span className={styles.brandSub}>Stock &amp; attendance</span>
          </span>
        </Link>
        <button
          type="button"
          className={styles.menuButton}
          aria-expanded={open}
          aria-controls="sidebar-menu"
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name={open ? "close" : "menu"} />
          Menu
        </button>
      </div>

      <div
        id="sidebar-menu"
        className={open ? `${styles.menu} ${styles.menuOpen}` : styles.menu}
      >
        <nav className={styles.nav} aria-label="Main">
          <ul className={styles.list}>
            <li>
              <NavLink
                href="/"
                icon="home"
                label="Dashboard"
                active={pathname === "/"}
                onNavigate={close}
              />
            </li>
          </ul>
          {sections.map((module) => (
            <section key={module.name} className={styles.section}>
              <h2 className={styles.sectionTitle}>{module.title}</h2>
              <ul className={styles.list}>
                {module.nav.map((item) => (
                  <li key={item.path}>
                    <NavLink
                      href={item.path}
                      icon={item.icon}
                      label={item.label}
                      active={isActivePath(pathname, item.path)}
                      onNavigate={close}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>

        <div className={styles.footer}>
          <span className={styles.userName}>{user.full_name}</span>
          <span className={styles.userRole}>{user.role_label}</span>
        </div>
      </div>
    </aside>
  );
}
