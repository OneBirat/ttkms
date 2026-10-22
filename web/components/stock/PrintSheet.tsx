"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import type { StockToday } from "./types";
import styles from "./print.module.css";
import "./print.global.css";

export interface PrintSheetProps {
  title: string;
  subtitle?: string;
  today: StockToday | null;
  /** Open the browser's print dialog once the content is ready. */
  auto: boolean;
  ready: boolean;
  wide?: boolean;
  legend: string;
  children: ReactNode;
}

/**
 * A4 print layout shared by the stock print routes: company header with BS +
 * AD date and the signed-in user, the content, and a footer legend with the
 * page number. Uses window.print(); the server-side PDF (WeasyPrint) is a
 * backend TODO and will reuse the same structure in a print/ template.
 */
export function PrintSheet({ title, subtitle, today, auto, ready, wide, legend, children }: PrintSheetProps) {
  const { user } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!auto || !ready) return;
    const timer = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(timer);
  }, [auto, ready]);

  return (
    <>
      <div className={`stock-print-screenbar ${styles.screenBar} ${wide ? styles.wide : ""}`}>
        <button type="button" className="btn" onClick={() => router.back()}>
          ‹ Back
        </button>
        <button type="button" className="btn btn--primary" onClick={() => window.print()} disabled={!ready}>
          Print / Save as PDF
        </button>
      </div>
      <article className={`${styles.sheet} ${wide ? styles.wide : ""}`} aria-busy={!ready}>
        <header className={styles.head}>
          <div>
            <div className={styles.company}>TTK · Stock</div>
            <div className={styles.title}>{title}</div>
            {subtitle ? <div className={styles.subtitle}>{subtitle}</div> : null}
          </div>
          <div className={styles.meta}>
            {today ? (
              <>
                <span lang="ne" className={styles.np}>
                  {today.bs_text_np}
                </span>
                <span>
                  {today.bs_text} BS · {today.ad_text}
                </span>
              </>
            ) : null}
            <span>Printed by {user?.full_name ?? "—"}</span>
          </div>
        </header>
        {ready ? children : <p className="muted">Preparing…</p>}
        <footer className={styles.foot}>
          <span>{legend}</span>
          {/* Page numbers: browsers cannot print counter(page) in body content; the
              WeasyPrint PDF (backend TODO) adds "Page N of M" in its running footer. */}
        </footer>
      </article>
    </>
  );
}
