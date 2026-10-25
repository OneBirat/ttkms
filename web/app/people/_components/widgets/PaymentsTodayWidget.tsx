import Link from "next/link";
import type { Widget } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import styles from "./widgets.module.css";

export type PaymentType = "salary" | "advance";

export interface PaymentTodayEntry {
  payment_id: number;
  employee_id: number;
  name: string;
  type: PaymentType;
  /** Rupees. */
  amount: number;
  /** Payment mode name (Cash, eSewa, ...). */
  mode: string;
  /** Kathmandu wall-clock "HH:MM". */
  time: string;
}

/** `data` of the `payments_today` widget (app/modules/payroll payments_today_data). */
export interface PaymentsTodayWidgetData {
  date: string;
  date_bs: string;
  count: number;
  total: number;
  salary_total: number;
  advance_total: number;
  /** Newest first. */
  payments: PaymentTodayEntry[];
  payments_path: string;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function readPaymentsData(data: Record<string, unknown>): PaymentsTodayWidgetData {
  const payments = Array.isArray(data.payments)
    ? data.payments
        .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
        .map<PaymentTodayEntry>((p) => ({
          payment_id: num(p.payment_id),
          employee_id: num(p.employee_id),
          name: String(p.name ?? ""),
          type: p.type === "advance" ? "advance" : "salary",
          amount: num(p.amount),
          mode: String(p.mode ?? ""),
          time: String(p.time ?? ""),
        }))
    : [];
  return {
    date: String(data.date ?? ""),
    date_bs: String(data.date_bs ?? ""),
    count: num(data.count),
    total: num(data.total),
    salary_total: num(data.salary_total),
    advance_total: num(data.advance_total),
    payments,
    payments_path: typeof data.payments_path === "string" ? data.payments_path : "/people/payments",
  };
}

/** "Payments today" card: totals, then each payment (newest first) with a link to Payment reports. */
export function PaymentsTodayWidget({ widget }: { widget: Widget }) {
  const d = readPaymentsData(widget.data);
  return (
    <section className={`card ${styles.card}`} aria-labelledby="pay-today-h">
      <div className={styles.head}>
        <h2 id="pay-today-h" className={styles.title}>
          {widget.title}
        </h2>
        <Link href={d.payments_path} className={styles.link}>
          Payment reports
        </Link>
      </div>
      <ul className={styles.totals}>
        <li className={styles.total}>
          <span className={styles.totalLabel}>Paid</span>
          <strong>Rs {formatNumber(d.total)}</strong>
          <span className={styles.totalHint}>
            {d.count} {d.count === 1 ? "payment" : "payments"}
          </span>
        </li>
        <li className={styles.total}>
          <span className={styles.totalLabel}>Salary</span>
          <strong>Rs {formatNumber(d.salary_total)}</strong>
        </li>
        <li className={styles.total}>
          <span className={styles.totalLabel}>Advances</span>
          <strong>Rs {formatNumber(d.advance_total)}</strong>
        </li>
      </ul>
      {d.payments.length > 0 ? (
        <ul className={styles.list}>
          {d.payments.map((p) => (
            <li key={p.payment_id} className={styles.row}>
              <span className={styles.rowType} data-type={p.type} aria-hidden="true">
                {p.type === "advance" ? "A" : "S"}
              </span>
              <span className={styles.rowText}>
                <span className={styles.rowName}>{p.name}</span>
                <span className={styles.rowSub}>
                  {p.type === "advance" ? "Advance" : "Salary"} · {p.mode} · {p.time}
                </span>
              </span>
              <strong className={styles.rowAmount}>{formatNumber(p.amount)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>No payments recorded today.</p>
      )}
    </section>
  );
}
