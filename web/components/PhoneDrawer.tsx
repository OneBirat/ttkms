"use client";

import { Fragment, useEffect, useRef, type KeyboardEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BranchSwitcher } from "@/components/BranchSwitcher";
import { Icon } from "@/components/icons";
import { isActivePath } from "@/components/Sidebar";
import { UserFooter } from "@/components/UserFooter";
import type { Module, User } from "@/lib/api";
import styles from "./PhoneDrawer.module.css";

export interface PhoneDrawerProps {
  user: User;
  /** "Admin · Main branch" under the name in the footer. */
  place: string;
  /** Sidebar sections from the session (enabled modules, permission-filtered). */
  modules: Module[];
  onClose: () => void;
  onLogout: () => void;
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The phone menu (< 640px): the same links as the sidebar - Dashboard, then
 * one titled group per module - and the same footer (user, Log out) fixed at
 * the bottom while the links scroll. Opened from the
 * shell's phone bar or from a screen's own menu button (useShell().openMenu);
 * closes on a link, the backdrop or Escape, and keeps Tab inside.
 */
export function PhoneDrawer({ user, place, modules, onClose, onLogout }: PhoneDrawerProps) {
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
            <span className={styles.brandSub}>Attendance &amp; payroll</span>
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
        <div className={styles.branch}>
          <BranchSwitcher />
        </div>

        <div className={styles.scroll}>
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
        </div>

        <UserFooter user={user} place={place} onLogout={onLogout} />
      </nav>
      <div aria-hidden="true" className={styles.backdrop} onClick={onClose} />
    </div>
  );
}
