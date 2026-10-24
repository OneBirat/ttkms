"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import type { AdminUser } from "../types";
import styles from "../components/admin.module.css";

export interface UserMenuProps {
  user: AdminUser;
  onView: () => void;
  onAccess: () => void;
  onReset: () => void;
  onEdit: () => void;
}

/** The ⋮ next to a name: Reset password · View details & access · Role & access · Edit user. */
export function UserMenu({ user, onView, onAccess, onReset, onEdit }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  // The table scrolls horizontally (a clipping container), so the menu is
  // positioned fixed next to the button and closes when anything scrolls.
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const toggle = () => {
    if (!open) {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) {
        const left = Math.min(rect.left, window.innerWidth - 236);
        setAt({ left, top: rect.bottom + 4 });
      }
    }
    setOpen((value) => !value);
  };

  const pick = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  const items: { label: string; icon: string; action: () => void }[] = [
    { label: "Reset password", icon: "lock", action: onReset },
    { label: "View details & access", icon: "eye", action: onView },
    { label: "Role & access", icon: "shield-check", action: onAccess },
    { label: "Edit user", icon: "edit", action: onEdit },
  ];

  return (
    <span ref={rootRef} style={{ display: "contents" }}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.dotBtn}
        aria-label={`More for ${user.full_name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
      >
        <Icon name="more" size={16} />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          className={styles.menu}
          style={at ? { position: "fixed", left: at.left, top: at.top } : undefined}
          aria-label={`Actions for ${user.full_name}`}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={pick(item.action)}
            >
              <Icon name={item.icon} size={16} />
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
