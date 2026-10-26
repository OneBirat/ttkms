"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/icons";
import { useActiveBranch } from "@/lib/branchContext";
import styles from "./BranchSwitcher.module.css";

const HINT = "Every page uses this branch until you change it.";

/**
 * The active-branch switcher (design/dashboard-branch/DashboardBranches.dc.html), under the logo in
 * the sidebar and the phone drawer: a dark button - house icon, "BRANCH", the branch name, ▾ -
 * opening a white menu of every active branch A-Z with its staff, the current one highlighted, and
 * the hint line. Closes on choose, outside click or Esc; arrow keys move through the branches.
 * Users without `see_other_branches` see the same block with their branch's name only.
 * `variant="bar"`: the compact pill in phone headers (a native select).
 */
export function BranchSwitcher({ variant = "sidebar" }: { variant?: "sidebar" | "bar" }) {
  const { branch, branches, canSwitch, switching, setActiveBranch } = useActiveBranch();
  const name = branch?.name ?? "No branch";
  const locked = !canSwitch || branches.length < 2;

  if (variant === "bar") {
    if (locked) {
      return (
        <div className={styles.bar} data-locked="true" data-testid="branch-name">
          <Icon name="home" size={16} />
          <span className={styles.barName}>{name}</span>
        </div>
      );
    }
    return (
      <label className={styles.bar} data-busy={switching || undefined} title={HINT}>
        <Icon name="home" size={16} />
        <span className={styles.barName}>{switching ? "Switching…" : name}</span>
        <Icon name="chevron-down" size={16} />
        <select
          aria-label="Active branch"
          data-testid="branch-switcher"
          value={branch?.id ?? ""}
          disabled={switching}
          onChange={(e) => void setActiveBranch(Number(e.target.value))}
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} · {b.staff} staff
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (locked) {
    return (
      <div className={styles.button} data-locked="true" data-testid="branch-name">
        <Icon name="home" size={16} className={styles.house} />
        <span className={styles.text}>
          <span className={styles.caption}>Branch</span>
          <span className={styles.name}>{name}</span>
        </span>
      </div>
    );
  }
  return <SidebarMenu />;
}

function SidebarMenu() {
  const { branch, branches, switching, error, setActiveBranch } = useActiveBranch();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();

  // Outside click closes the menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Opening focuses the current branch.
  useEffect(() => {
    if (!open) return;
    const current = wrap.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
    (current ?? wrap.current?.querySelector<HTMLElement>('[role="option"]'))?.focus();
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  const choose = (id: number) => {
    close();
    void setActiveBranch(id);
  };
  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(wrap.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = event.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      items[next]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  return (
    <div ref={wrap} className={styles.wrap}>
      <button
        ref={button}
        type="button"
        className={styles.button}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-testid="branch-switcher"
        data-busy={switching || undefined}
        title={HINT}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon name="home" size={16} className={styles.house} />
        <span className={styles.text}>
          <span className={styles.caption}>Branch</span>
          <span className={styles.name}>{switching ? "Switching…" : (branch?.name ?? "No branch")}</span>
        </span>
        <Icon name="chevron-down" size={14} />
      </button>
      {open ? (
        <div id={menuId} role="listbox" aria-label="Active branch" className={styles.menu} onKeyDown={onMenuKey}>
          {branches.map((b) => {
            const on = b.id === branch?.id;
            return (
              <button
                key={b.id}
                type="button"
                role="option"
                aria-selected={on}
                className={styles.option}
                data-branch={b.id}
                onClick={() => choose(b.id)}
              >
                <span className={styles.optionName}>{b.name}</span>
                <span className={styles.optionStaff}>{b.staff} staff</span>
              </button>
            );
          })}
          <span className={styles.hint}>{HINT}</span>
        </div>
      ) : null}
      {error ? (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
