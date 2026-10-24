import { TODAY_LABEL } from "../_lib/helpers";
import type { TodayStatus } from "../types";
import styles from "./employees.module.css";

/** P / O / A / W / not marked as the design's coloured pill. */
export function TodayPill({ status, small = false }: { status: TodayStatus; small?: boolean }) {
  return (
    <span className={small ? `${styles.todayPill} ${styles.todayPillSmall}` : styles.todayPill} data-status={status}>
      {TODAY_LABEL[status]}
    </span>
  );
}
