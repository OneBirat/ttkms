import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import styles from "./EmptyState.module.css";

export interface EmptyStateProps {
  title: string;
  text?: string;
  icon?: IconName;
  children?: ReactNode;
}

export function EmptyState({
  title,
  text,
  icon = "inbox",
  children,
}: EmptyStateProps) {
  return (
    <div className={`card ${styles.empty}`}>
      <span className={styles.icon}>
        <Icon name={icon} size={26} />
      </span>
      <h2 className={styles.title}>{title}</h2>
      {text ? <p className={styles.text}>{text}</p> : null}
      {children ? <div className={styles.actions}>{children}</div> : null}
    </div>
  );
}
