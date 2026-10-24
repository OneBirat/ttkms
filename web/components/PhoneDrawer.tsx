"use client";

import { Fragment, useEffect, useRef, type KeyboardEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";
import { isActivePath } from "@/components/Sidebar";
import type { Module, User } from "@/lib/api";
import styles from "./PhoneDrawer.module.css";

export interface PhoneDrawerProps {
  user: User;
  /** Sidebar sections from the session (enabled modules, permission-filtered). */
  modules: Module[];
  onClose: () => void;
  onLogout: () => void;
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The phone menu (< 640px): the same links as the sidebar - Dashboard, then
 * one titled group per module - plus the user and Sign out. Opened from the
 * shell's phone bar or from a screen's own menu button (useShell().openMenu);
 * closes on a link, the backdrop or Escape, and keeps Tab inside.
 */
export function PhoneDrawer({ user, modules, onClose, onLogout }: PhoneDrawerProps) {
  const pathname = usePathname();
  const ref = useRef<HTMLElement | null>(null);
  const sections = modules.filter((module) => module.nav.length > 0);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab" || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className={styles.wrap}>
      <nav
        ref={ref}
        className={styles.drawer}
        aria-label="Menu"
        role="dialog"
        aria-modal="true"
        onKeyDown={onKeyDown}
      >
        <div className={styles.brand}>
          <span className={styles.tile} aria-hidden="true">
            TT
          </span>
          <span className={styles.brandText}>
            <span className={styles.brandName}>TTK Attendance</span>
            <span className={styles.brandSub}>
              {user.full_name} · {user.role_label}
            </span>
          </span>
          <button
            type="button"
            aria-label="Close menu"
            className={styles.close}
            onClick={onClose}
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <Link
          href="/"
          className={styles.link}
          aria-current={pathname === "/" ? "page" : undefined}
          onClick={onClose}
        >
          <Icon name="dashboard" />
          Dashboard
        </Link>
        {sections.map((module) => (
          <Fragment key={module.name}>
            <div className={styles.head} data-module={module.name}>
              {module.title}
            </div>
            {module.nav.map((item) => (
              <Link
                key={item.path}
                href={item.path}
                className={styles.link}
                aria-current={isActivePath(pathname, item.path) ? "page" : undefined}
                onClick={onClose}
              >
                <Icon name={item.icon} />
                {item.label}
              </Link>
            ))}
          </Fragment>
        ))}

        <button type="button" className={styles.signOut} onClick={onLogout}>
          <Icon name="logout" size={16} />
          Sign out
        </button>
      </nav>
      <div aria-hidden="true" className={styles.backdrop} onClick={onClose} />
    </div>
  );
}
