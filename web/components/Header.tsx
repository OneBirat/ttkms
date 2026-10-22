"use client";

import { Icon } from "@/components/icons";
import { Pill } from "@/components/ui/Pill";
import type { Today, User } from "@/lib/api";
import styles from "./Header.module.css";

export interface HeaderProps {
  today: Today | null;
  user: User;
  onLogout: () => void;
}

function fallbackDate(): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date());
}

function TodayLine({ today }: { today: Today | null }) {
  if (!today) {
    return <span>{fallbackDate()}</span>;
  }
  if (!today.available) {
    return (
      <>
        <span>{today.text.ad}</span>
        <Pill status="low" label="BS calendar not installed" />
      </>
    );
  }
  return (
    <>
      <span lang="ne" className={styles.np}>
        {today.text.np}
      </span>
      <span className={styles.sep} aria-hidden="true">
        ·
      </span>
      <span>{today.text.bs_en}</span>
      <span className={styles.sep} aria-hidden="true">
        ·
      </span>
      <span>{today.text.ad}</span>
    </>
  );
}

export function Header({ today, user, onLogout }: HeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.date}>
        <Icon name="calendar" size={18} />
        <TodayLine today={today} />
      </div>
      <div className={styles.user}>
        <span className={styles.name}>{user.full_name}</span>
        <button type="button" className="btn btn--ghost" onClick={onLogout}>
          <Icon name="logout" size={18} />
          Sign out
        </button>
      </div>
    </header>
  );
}
