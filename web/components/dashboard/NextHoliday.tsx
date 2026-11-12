"use client";

import { useEffect, useState } from "react";
import { addDays } from "@/lib/bs";
import { listHolidays } from "@/components/attendance/api";
import { bsTile, inDaysText, nextHoliday, scopeText, weekdayAndAd } from "@/components/attendance/holidays/model";
import type { Holiday } from "@/components/attendance/types";
import styles from "@/components/attendance/holidays/holidays.module.css";

/** How far ahead the strip looks for the next holiday. */
const LOOK_AHEAD_DAYS = 366;

/**
 * "Next public holiday" under the Dashboard header, for everyone: the next holiday that applies
 * to the active branch (today counts). BS day and month in a small tile, the name, weekday and
 * AD date, "All branches" or the branch names, and "in N days". Nothing when none is coming.
 * `todayAd` is the server's Kathmandu day (GET /api/today).
 */
export function NextHoliday({ todayAd, branchId }: { todayAd: string | null; branchId: number | null }) {
  const [found, setFound] = useState<{ holiday: Holiday; today: string } | null>(null);

  useEffect(() => {
    if (!todayAd) return;
    let cancelled = false;
    listHolidays(todayAd, addDays(todayAd, LOOK_AHEAD_DAYS), branchId)
      .then((list) => {
        if (cancelled) return;
        const holiday = nextHoliday(list.holidays, list.today);
        setFound(holiday ? { holiday, today: list.today } : null);
      })
      .catch(() => {
        if (!cancelled) setFound(null); // attendance paused or no access: no strip
      });
    return () => {
      cancelled = true;
    };
  }, [todayAd, branchId]);

  if (!found) return null;
  const { holiday, today } = found;
  const tile = bsTile(holiday.date_bs);
  return (
    <section aria-label="Next public holiday" className={styles.strip} data-testid="next-holiday">
      <span className={styles.tile} aria-hidden="true">
        <span className={styles.tileDay}>{tile.day}</span>
        <span className={styles.tileMonth}>{tile.month}</span>
      </span>
      <span className={styles.stripText}>
        <span className={styles.stripLabel}>Next public holiday</span>
        <span className={styles.stripName}>{holiday.name}</span>
        <span className={styles.stripMeta}>
          {weekdayAndAd(holiday.date)} · {scopeText(holiday)}
        </span>
      </span>
      <span className={styles.stripIn}>{inDaysText(holiday.date, today)}</span>
    </section>
  );
}
