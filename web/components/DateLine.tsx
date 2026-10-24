"use client";

import { BSDateText, DateLangToggle } from "@/components/date";
import { fiscalYear, todayBs } from "@/lib/bs";
import type { Today } from "@/lib/api";
import styles from "./DateLine.module.css";

/**
 * Today's date in the page header, BS first with the weekday, AD small, and the fiscal year:
 * "शनिबार, कार्तिक ७, २०८३ · 24 Oct 2026 · FY 2083/84". The server's /api/today is preferred (it
 * is the same calendar table); until it arrives the browser computes today in Kathmandu itself.
 */
export function DateLine({ today }: { today: Today | null }) {
  const bs = today?.date_bs ?? todayBs();
  return (
    <div className={styles.line}>
      <BSDateText value={bs} weekday inline />
      <span aria-hidden="true">·</span>
      <span className={styles.fy}>FY {today?.fiscal_year ?? fiscalYear(bs).label}</span>
      <DateLangToggle className={styles.toggle} />
    </div>
  );
}
