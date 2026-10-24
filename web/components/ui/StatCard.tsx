import Link from "next/link";
import type { Tone } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import styles from "./StatCard.module.css";

export interface StatCardProps {
  label: string;
  value: number;
  /** Small line under the value ("across 12 products"); becomes a link when href is set. */
  hint?: string | null;
  /** Colours the value: low (amber), danger (red), leave (blue). */
  tone?: Tone | null;
  href?: string | null;
}

/** Summary card from the design: label, big value, hint or link. */
export function StatCard({ label, value, hint, tone, href }: StatCardProps) {
  return (
    <div className={`card ${styles.card}`} data-tone={tone ?? "neutral"}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{formatNumber(value)}</span>
      {href ? (
        <Link href={href} className={styles.link}>
          {hint ?? "See details"}
        </Link>
      ) : hint ? (
        <span className={styles.hint}>{hint}</span>
      ) : null}
    </div>
  );
}
