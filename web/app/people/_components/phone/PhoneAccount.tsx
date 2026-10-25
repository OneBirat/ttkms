"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import { BottomSheet } from "./BottomSheet";
import { PaySheet } from "./PaySheet";
import { PhoneFrame } from "./PhoneFrame";
import { PhotoSheet } from "./PhotoSheet";
import { Avatar } from "../Avatar";
import { BarcodeDialog } from "../BarcodeDialog";
import { EditProfileDialog } from "../EditProfileDialog";
import { PayrollIcon } from "../icons";
import { currentMonth, getAccountSummary, getEmployee, getEmployeeLedger, getLedger, getSalaryStructure } from "../../api";
import { formatBs, formatBsShort } from "@/lib/bs";
import { monthLabel, monthName } from "../../_lib/months";
import { formatAmount, formatRs } from "../../_lib/helpers";
import type { Employee, LedgerEntry, LedgerEntryType, MonthLedger, PaymentType } from "../../types";
import { payrollErrorMessage, usePayroll } from "../../_lib/usePayroll";
import styles from "./phone.module.css";
import shared from "../payroll.module.css";

type Tab = "salary" | "ledger" | "profile";
type Sheet = null | { kind: "actions" } | { kind: "photo" } | { kind: "pay"; type: PaymentType } | { kind: "barcode" } | { kind: "edit" };

const TX_CHIPS: { value: "all" | LedgerEntryType; label: string }[] = [
  { value: "all", label: "All" },
  { value: "salary", label: "Salary" },
  { value: "overtime", label: "Overtime" },
  { value: "advance", label: "Advance" },
  { value: "salary_paid", label: "Salary paid" },
];

const TX_SYMBOL: Record<LedgerEntryType, string> = { salary: "+", absence: "−", overtime: "⏱", advance: "−", salary_paid: "−" };
const TX_LABEL: Record<LedgerEntryType, string> = {
  salary: "Salary earned",
  absence: "Absence deducted",
  overtime: "Overtime earned",
  advance: "Advance paid",
  salary_paid: "Salary paid",
};

/** Phone: one employee's account with Salary / Ledger / Profile tabs (design PayrollMobile, account screen). */
export function PhoneAccount({ id }: { id: number }) {
  const { user } = useSession();
  const isAdmin = user?.role === "admin";
  const employee = usePayroll(() => getEmployee(id), [id]);
  const structure = usePayroll(() => getSalaryStructure(id), [id]);
  const summary = usePayroll(() => getAccountSummary(id), [id]);
  const [tab, setTab] = useState<Tab>("salary");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(null), 6000);
    return () => clearTimeout(timer);
  }, [banner]);

  const person = employee.data;
  const s = summary.data;
  const current = structure.data?.current ?? null;

  return (
    <PhoneFrame title={person?.full_name ?? "Employee"} subtitle="Employee account" backHref="/people/employees" onMore={person ? () => setSheet({ kind: "actions" }) : undefined}>
      {employee.error ? <p className={styles.empty}>{payrollErrorMessage(employee.error)}</p> : null}
      {!person && !employee.error ? <p className={styles.empty}>Loading…</p> : null}
      {person ? (
        <>
          <div className={`${styles.card} ${styles.accountCard}`}>
            <div className={styles.accountTop}>
              <button type="button" className={styles.avatarButton} aria-label="Update profile picture" onClick={() => setSheet({ kind: "photo" })}>
                <Avatar name={person.full_name} photoUrl={person.photo_url} size={56} tone="profile" />
                <span aria-hidden="true" className={styles.cameraBadge}>
                  <PayrollIcon name="camera" size={12} strokeWidth={2.4} />
                </span>
              </button>
              <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                <span className={styles.accountName}>{person.full_name}</span>
                {person.full_name_np ? (
                  <span className={styles.accountNp} lang="ne">
                    {person.full_name_np}
                  </span>
                ) : null}
                <span className={styles.rowSub} style={{ fontSize: 13 }}>
                  {[person.designation, person.department?.name, person.code].filter(Boolean).join(" · ")}
                </span>
                <span className={styles.rowSub}>
                  Joined {person.joined.bs} · {person.phone ?? "no phone"}
                </span>
              </div>
              <span className={styles.pill} data-tone={person.active ? "ok" : "danger"} style={{ fontSize: 12, padding: "3px 9px" }}>
                {person.active ? "Active" : "Inactive"}
              </span>
            </div>
            <button type="button" className={styles.wideButton} onClick={() => setSheet({ kind: "photo" })}>
              <PayrollIcon name="camera" size={16} />
              Update profile picture
            </button>
            {banner ? (
              <div role="status" className={styles.banner}>
                {banner}
              </div>
            ) : null}
            <div className={styles.tiles3}>
              <div className={shared.tile} data-tone="ok">
                <span className={shared.tileLabel}>{current?.pay_type === "daily" ? "Daily wage" : "Monthly salary"}</span>
                <span className={shared.tileValue} style={{ fontSize: 14 }}>
                  {current ? formatRs(current.pay_type === "daily" ? current.basic : current.gross) : "—"}
                </span>
              </div>
              <div className={shared.tile} data-tone="ot">
                <span className={shared.tileLabel}>Overtime · {monthName(currentMonth())}</span>
                <span className={shared.tileValue} style={{ fontSize: 14 }}>
                  {s ? `${s.overtime_hours_this_month} h` : "…"}
                </span>
              </div>
              <div className={shared.tile} data-tone="danger">
                <span className={shared.tileLabel}>Balance due</span>
                <span className={shared.tileValue} style={{ fontSize: 14 }}>
                  {s ? formatRs(s.balance_due) : "…"}
                </span>
              </div>
            </div>
            <div className={styles.actions2}>
              <button type="button" className={styles.advanceBtn} onClick={() => setSheet({ kind: "pay", type: "advance" })}>
                Give advance
              </button>
              <button type="button" className={styles.salaryBtn} disabled={!s || s.salary_due <= 0} onClick={() => setSheet({ kind: "pay", type: "salary" })}>
                {s && s.salary_due <= 0 ? `${monthName(s.salary_month)} salary paid` : `Pay ${s ? monthName(s.salary_month) : ""} salary`}
              </button>
            </div>
          </div>

          <div role="tablist" className={styles.segTabs}>
            {(["salary", "ledger", "profile"] as Tab[]).map((t) => (
              <button key={t} type="button" role="tab" className={styles.segTab} aria-selected={tab === t} onClick={() => setTab(t)}>
                {t === "salary" ? "Salary" : t === "ledger" ? "Ledger" : "Profile"}
              </button>
            ))}
          </div>

          {tab === "salary" ? <SalaryTab id={person.id} /> : null}
          {tab === "ledger" ? <LedgerTab id={person.id} /> : null}
          {tab === "profile" ? <ProfileTab employee={person} paidBy={current?.default_payment_mode.name ?? null} /> : null}

          <BottomSheet open={sheet?.kind === "actions"} label="Actions" onClose={() => setSheet(null)}>
            <button type="button" className={styles.sheetAction} data-tone="advance" onClick={() => setSheet({ kind: "pay", type: "advance" })}>
              Give advance
            </button>
            <button type="button" className={styles.sheetAction} data-tone="ok" onClick={() => setSheet({ kind: "pay", type: "salary" })}>
              Pay {s ? monthName(s.salary_month) : ""} salary
            </button>
            <button
              type="button"
              className={styles.sheetAction}
              onClick={() => {
                setTab("ledger");
                setSheet(null);
              }}
            >
              View ledger
            </button>
            <button type="button" className={styles.sheetAction} onClick={() => setSheet({ kind: "barcode" })}>
              View barcode
            </button>
            <Link href="/attendance/report" className={styles.sheetAction}>
              Attendance report
            </Link>
            <button type="button" className={styles.sheetAction} onClick={() => setSheet({ kind: "edit" })}>
              Edit profile
            </button>
            <button type="button" className={styles.sheetCancel} onClick={() => setSheet(null)}>
              Close
            </button>
          </BottomSheet>
          <PhotoSheet open={sheet?.kind === "photo"} employee={person} onClose={() => setSheet(null)} onChanged={setBanner} />
          {sheet?.kind === "pay" ? <PaySheet open employee={person} initialType={sheet.type} isAdmin={isAdmin} onClose={() => setSheet(null)} /> : null}
          <BarcodeDialog open={sheet?.kind === "barcode"} employee={person} onClose={() => setSheet(null)} />
          <EditProfileDialog
            open={sheet?.kind === "edit"}
            employee={person}
            onClose={() => setSheet(null)}
            onSaved={() => {
              setSheet(null);
              setBanner("Profile updated");
            }}
          />
        </>
      ) : null}
    </PhoneFrame>
  );
}

function SalaryTab({ id }: { id: number }) {
  const ledger = usePayroll(() => getLedger(id), [id]);
  const [open, setOpen] = useState<number>(0);
  if (!ledger.data) return <p className={styles.empty}>Loading…</p>;
  return (
    <>
      {ledger.data.map((l: MonthLedger, i) => {
        const on = open === i;
        return (
          <div key={`${l.month.bs_year}-${l.month.bs_month}`} className={styles.card}>
            <button type="button" className={styles.monthButton} aria-expanded={on} onClick={() => setOpen(on ? -1 : i)}>
              <span style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                <span className={styles.monthTitle}>
                  {monthLabel(l.month)}
                  {l.in_progress ? <span className={styles.rowSub}> · so far</span> : null}
                </span>
                <span className={styles.rowSub}>
                  Net Rs {formatAmount(l.net)} · paid Rs {formatAmount(l.paid)}
                </span>
              </span>
              <span className={styles.pill} data-tone={l.due === 0 ? "ok" : "danger"}>
                {l.due === 0 ? "Paid" : "Due"}
              </span>
              <span className={styles.rowChevron} style={{ fontSize: 18 }} aria-hidden="true">
                {on ? "▾" : "›"}
              </span>
            </button>
            {on ? (
              <div className={styles.monthDetail}>
                <div className={styles.kvLine}>
                  <span>{l.pay_type === "monthly" ? "Monthly salary" : `Daily wage × ${l.paid_days} days`}</span>
                  <span className="mono">Rs {formatAmount(l.gross_salary)}</span>
                </div>
                <div className={styles.kvLine} style={{ color: "#7a5600" }}>
                  <span>Overtime {l.attendance.overtime_hours} h</span>
                  <span className="mono">+{formatAmount(l.overtime_pay)}</span>
                </div>
                <div className={styles.kvLine} style={{ color: "var(--pill-danger-fg)" }}>
                  <span>Absence {l.attendance.absent} d</span>
                  <span className="mono">−{formatAmount(l.absence_deduction)}</span>
                </div>
                <div className={`${styles.kvLine} ${styles.kvTotal}`}>
                  <span>Net pay</span>
                  <span className="mono">Rs {formatAmount(l.net)}</span>
                </div>
                {l.payments.map((p) => (
                  <div key={p.id} className={styles.kvLine} style={{ color: "var(--pill-leave-fg)" }}>
                    <span>
                      {formatBsShort(p.date.bs)} · {p.kind === "advance" ? "Advance" : "Paid"} ({p.payment_mode.name})
                    </span>
                    <span className="mono">−{formatAmount(p.amount)}</span>
                  </div>
                ))}
                <div className={`${styles.kvLine} ${styles.kvTotal}`} style={{ borderTop: "none", paddingTop: 0, color: l.due ? "var(--pill-danger-fg)" : "var(--color-muted)" }}>
                  <span>Still due</span>
                  <span className="mono">Rs {formatAmount(l.due)}</span>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function LedgerTab({ id }: { id: number }) {
  const ledger = usePayroll(() => getEmployeeLedger(id), [id]);
  const [filter, setFilter] = useState<"all" | LedgerEntryType>("all");
  if (!ledger.data) return <p className={styles.empty}>Loading…</p>;
  const entries = [...ledger.data.entries].reverse().filter((e) => filter === "all" || e.type === filter || (filter === "salary" && e.type === "absence"));
  const groups: { key: string; month: LedgerEntry["month"]; rows: LedgerEntry[] }[] = [];
  for (const e of entries) {
    const key = `${e.month.bs_year}-${e.month.bs_month}`;
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, month: e.month, rows: [] };
      groups.push(g);
    }
    g.rows.push(e);
  }
  return (
    <>
      <div className={styles.chips} role="group" aria-label="Type">
        {TX_CHIPS.map((c) => (
          <button key={c.value} type="button" className={styles.chip} aria-pressed={filter === c.value} onClick={() => setFilter(c.value)}>
            {c.label}
          </button>
        ))}
      </div>
      {groups.length === 0 ? <p className={styles.empty}>Nothing here yet.</p> : null}
      {groups.map((g) => {
        const earned = g.rows.reduce((s, e) => s + e.earned, 0);
        const paid = g.rows.reduce((s, e) => s + e.paid, 0);
        return (
          <div key={g.key}>
            <div className={styles.groupHead}>
              <span className={styles.groupTitle}>{monthLabel(g.month)}</span>
              <span className="mono" style={{ fontSize: 12, color: "var(--color-muted)" }}>
                {earned ? `+${formatAmount(earned)}` : ""}
                {earned && paid ? " · " : ""}
                {paid ? `−${formatAmount(paid)}` : ""}
              </span>
            </div>
            <div className={styles.card} style={{ marginTop: 4 }}>
              {g.rows.map((e) => (
                <div key={e.id} className={styles.txRow}>
                  <span className={styles.txIcon} data-type={e.type} aria-hidden="true">
                    {TX_SYMBOL[e.type]}
                  </span>
                  <span className={styles.txText}>
                    <span className={styles.txLine}>
                      <span className={styles.txLabel}>{TX_LABEL[e.type]}</span>
                      {e.voided && e.payment ? (
                        <span className={`${styles.txAmount} ${shared.voidedAmount}`}>−Rs {formatAmount(e.payment.amount)}</span>
                      ) : (
                        <span className={styles.txAmount} style={{ color: e.earned > 0 ? "var(--pill-ok-fg)" : "var(--pill-danger-fg)" }}>
                          {e.earned ? `${e.earned < 0 ? "−" : "+"}Rs ${formatAmount(Math.abs(e.earned))}` : `−Rs ${formatAmount(e.paid)}`}
                        </span>
                      )}
                    </span>
                    <span className={styles.txLine}>
                      <span className={styles.txWhen}>
                        {formatBs(e.date.bs)}
                        {e.paid > 0 ? ` · for ${monthName(e.month)}` : ""}
                        {e.in_progress ? " · so far" : ""}
                      </span>
                      <span className={styles.txBalance}>Balance {formatAmount(e.balance)}</span>
                    </span>
                    <span className={styles.txDet}>{e.details}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function ProfileTab({ employee: e, paidBy }: { employee: Employee; paidBy: string | null }) {
  const rows: [string, string][] = [
    ["Employee ID", `${e.code} · ${e.barcode}`],
    ["Name in Nepali", e.full_name_np ?? "—"],
    ["Department", e.department?.name ?? "—"],
    ["Designation", e.designation ?? "—"],
    ["Branch", e.branch.name],
    ["Phone", e.phone ?? "—"],
    ["Extra contact", e.phone_alt ?? "—"],
    ["Address", e.address ?? "—"],
    ["Joined", e.joined.bs],
    ["Salary paid to", paidBy ?? "—"],
    ["App login", e.login ? `${e.login.username} (${e.login.role_label.toLowerCase()})` : "none"],
  ];
  return (
    <div className={styles.card} style={{ padding: "6px 14px" }}>
      {rows.map(([k, v]) => (
        <div key={k} className={styles.profileRow}>
          <span className={styles.profileKey}>{k}</span>
          <span className={styles.profileValue} lang={k === "Name in Nepali" ? "ne" : undefined}>
            {v}
          </span>
        </div>
      ))}
    </div>
  );
}
