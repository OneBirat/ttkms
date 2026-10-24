import { Pill } from "@/components/ui/Pill";
import type { Today } from "@/lib/api";
import styles from "./DateLine.module.css";

/**
 * Today's date as in the design header:
 * "मंगलबार, कार्तिक ४, २०८३ · Kartik 4, 2083 BS · Tue 20 Oct 2026".
 * While the BS calendar table is not installed only the AD date is known.
 */
export function DateLine({ today }: { today: Today | null }) {
  if (!today) return null;
  if (!today.available) {
    return (
      <div className={styles.line}>
        <span>{today.text.ad}</span>
        <Pill status="low" label="BS calendar not installed" />
      </div>
    );
  }
  return (
    <div className={styles.line}>
      <span lang="ne" className={styles.np}>
        {today.text.np}
      </span>
      <span aria-hidden="true">·</span>
      <span>{today.text.bs_en}</span>
      <span aria-hidden="true">·</span>
      <span>{today.text.ad}</span>
    </div>
  );
}
