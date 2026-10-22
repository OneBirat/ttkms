import type { ReactNode } from "react";
import styles from "./PageHeader.module.css";

export interface PageHeaderProps {
  title: string;
  /** One-line description under the title (module pages). */
  subtitle?: string;
  /** Extra line under the title, e.g. <DateLine> on the dashboard. */
  meta?: ReactNode;
  /** Buttons/links on the right, e.g. <a className="btn btn--primary">. */
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, meta, actions }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.text}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        {meta}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
