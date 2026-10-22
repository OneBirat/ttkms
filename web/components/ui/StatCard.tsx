import Link from "next/link";
import type { Tone } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import styles from "./StatCard.module.css";

export interface StatCardProps {
  label: string;
  value: number;
  hint?: string | null;
  tone?: Tone | null;
  href?: string | null;
}

export function StatCard({ label, value, hint, tone, href }: StatCardProps) {
  const body = (
    <>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{formatNumber(value)}</span>
      {hint ? <span className={styles.hint}>{hint}</span> : null}
    </>
  );
  const className = `card ${styles.card}`;
  const dataTone = tone ?? "neutral";

  if (href) {
    return (
      <Link href={href} className={className} data-tone={dataTone}>
        {body}
      </Link>
    );
  }
  return (
    <div className={className} data-tone={dataTone}>
      {body}
    </div>
  );
}
