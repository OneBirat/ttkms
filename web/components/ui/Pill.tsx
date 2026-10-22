import type { Tone } from "@/lib/api";
import styles from "./Pill.module.css";

const TONE_BY_STATUS: Record<string, Tone> = {
  ok: "ok",
  active: "ok",
  present: "ok",
  paid: "ok",
  success: "ok",
  in: "ok",
  low: "low",
  late: "low",
  pending: "low",
  warning: "low",
  half: "low",
  half_day: "low",
  out: "danger",
  danger: "danger",
  inactive: "danger",
  absent: "danger",
  error: "danger",
  leave: "leave",
  info: "leave",
  blue: "leave",
};

export function pillTone(status: string): Tone {
  return TONE_BY_STATUS[status.toLowerCase()] ?? "neutral";
}

/** "half_day" -> "Half day" */
export function pillLabel(status: string): string {
  const text = status.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface PillProps {
  status: string;
  label?: string;
  className?: string;
}

export function Pill({ status, label, className }: PillProps) {
  return (
    <span
      className={className ? `${styles.pill} ${className}` : styles.pill}
      data-tone={pillTone(status)}
    >
      {label ?? pillLabel(status)}
    </span>
  );
}
