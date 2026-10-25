"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pill } from "@/components/ui/Pill";
import { useSession } from "@/lib/session";
import { AdvanceDialog } from "./AdvanceDialog";
import { Avatar } from "./Avatar";
import { BarcodeDialog } from "./BarcodeDialog";
import { EditProfileDialog } from "./EditProfileDialog";
import { LedgerTable } from "./LedgerTable";
import { PaymentDialog } from "./PaymentDialog";
import { PhotoDialog } from "./PhotoDialog";
import { ReviseSalaryDialog } from "./ReviseSalaryDialog";
import { TransactionsLedger } from "./TransactionsLedger";
import { currentMonth, getAttendance, getEmployee, getLedger, getSalaryStructure, suggestPayMonth } from "../api";
import { BSDateText } from "@/components/date";
import { formatBs } from "@/lib/bs";
import { monthLabel, monthName, sameMonth } from "../_lib/months";
import { formatAmount, formatDays, formatRs } from "../_lib/helpers";
import { PayrollIcon } from "./icons";
import type { BsMonth, Employee, MonthLedger, Payment, SalaryStructure } from "../types";
import { payrollErrorMessage, usePayroll } from "../_lib/usePayroll";
import styles from "./employees.module.css";
import shared from "./payroll.module.css";

export type AccountTab = "overview" | "salary" | "ledger" | "attendance" | "documents";

export const ACCOUNT_TABS: { value: AccountTab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "salary", label: "Salary" },
  { value: "ledger", label: "Ledger" },
  { value: "attendance", label: "Attendance" },
  { value: "documents", label: "Documents" },
];

export function isAccountTab(value: string | null): value is AccountTab {
  return ACCOUNT_TABS.some((t) => t.value === value);
}

type Dialog =
  | { kind: "edit" }
  | { kind: "revise" }
  | { kind: "photo" }
  | { kind: "barcode" }
  | { kind: "advance" }
  | { kind: "payment"; purpose: "salary" | "record"; month: BsMonth };

export interface EmployeeAccountProps {
  id: number;
  tab: AccountTab;
  onTab: (tab: AccountTab) => void;
}

/** One employee's account: profile card, tabs, salary / ledger / attendance. */
export function EmployeeAccount({ id, tab, onTab }: EmployeeAccountProps) {
  const { user } = useSession();
  const isAdmin = user?.role === "admin";
  const employee = usePayroll(() => getEmployee(id), [id]);
  const structure = usePayroll(() => getSalaryStructure(id), [id]);
  const ledger = usePayroll(() => getLedger(id), [id]);
  const payMonth = usePayroll(() => suggestPayMonth(id), [id]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  if (employee.error) {
    return (
      <EmptyState icon="alert" title="Could not load this employee" text={payrollErrorMessage(employee.error)}>
        <button type="button" className="btn" onClick={employee.reload}>
          Try again
        </button>
      </EmptyState>
    );
  }
  const person = employee.data;
  if (!person) {
    return (
      <p className="muted" role="status">
        Loading…
      </p>
    );
  }

  const month = payMonth.data ?? currentMonth();
  const monthRow = ledger.data?.find((l) => sameMonth(l.month, month)) ?? null;
  const salaryDue = monthRow ? monthRow.due : 0;
  const meta = [person.designation, person.department?.name, person.code].filter(Boolean).join(" · ");
  const current = structure.data?.current ?? null;

  return (
    <>
      <section aria-label="Profile" className={`card ${styles.profile}`}>
        <div className={styles.profileMain}>
          <div className={styles.photoWrap}>
            <Avatar name={person.full_name} photoUrl={person.photo_url} size={72} tone="profile" />
            <button
              type="button"
              className={styles.cameraButton}
              aria-label="Change photo (QR code for a phone, or this device)"
              onClick={() => setDialog({ kind: "photo" })}
            >
              <PayrollIcon name="camera" size={16} />
            </button>
          </div>
          <div className={styles.profileText}>
            <div className={styles.nameRow}>
              <h2 className={styles.name}>{person.full_name}</h2>
              <Pill status={person.active ? "active" : "inactive"} />
            </div>
            {person.full_name_np ? (
              <span className={styles.nameNp} lang="ne">
                {person.full_name_np}
              </span>
            ) : null}
            <span className={styles.line}>{meta}</span>
            <span className={styles.lineSmall}>
              Joined {formatBs(person.joined.bs)} · {person.phone ?? "no phone"} · Login:{" "}
              {person.login ? `${person.login.username} (${person.login.role_label.toLowerCase()})` : "none"}
            </span>
          </div>
        </div>
        <div className={styles.profileActions}>
          <button type="button" className="btn" onClick={() => setDialog({ kind: "edit" })}>
            Edit profile
          </button>
          <button type="button" className="btn" onClick={() => setDialog({ kind: "barcode" })}>
            <PayrollIcon name="barcode" size={18} />
            View barcode
          </button>
          <button type="button" className={`btn ${styles.advanceButton}`} onClick={() => setDialog({ kind: "advance" })}>
            Give advance
          </button>
          {salaryDue > 0 ? (
            <button type="button" className="btn btn--primary" onClick={() => setDialog({ kind: "payment", purpose: "salary", month })}>
              Pay {monthName(month)} salary
            </button>
          ) : (
            <button type="button" className="btn btn--primary" disabled title={`Nothing due for ${monthLabel(month)}`}>
              {monthName(month)} salary paid
            </button>
          )}
        </div>
      </section>

      <div role="tablist" aria-label="Employee sections" className={shared.tabs}>
        {ACCOUNT_TABS.map((t) => (
          <button key={t.value} type="button" role="tab" className={shared.tab} aria-selected={tab === t.value} onClick={() => onTab(t.value)}>
            {t.label}
          </button>
        ))}
      </div>

      {toast ? (
        <p className={toast.error ? `${shared.toast} ${shared.toastError}` : shared.toast} role="status">
          {toast.text}
        </p>
      ) : null}

      {tab === "salary" ? (
        <>
          <div className={styles.twoCards}>
            <SalaryStructureCard structure={current} onRevise={() => setDialog({ kind: "revise" })} />
            <AdvancesCard ledger={ledger.data ?? []} onGiveAdvance={() => setDialog({ kind: "advance" })} />
          </div>
          <LedgerTable
            employee={person}
            ledger={ledger.data ?? []}
            onRecordPayment={(m) => setDialog({ kind: "payment", purpose: "record", month: m })}
          />
        </>
      ) : null}

      {tab === "ledger" ? <TransactionsLedger employee={person} /> : null}

      {tab === "overview" ? <OverviewTab employee={person} structure={current} ledger={ledger.data ?? []} /> : null}

      {tab === "attendance" ? <AttendanceTab employee={person} /> : null}

      {tab === "documents" ? (
        <div className={`card ${styles.placeholder}`}>
          Documents — not designed yet. Contracts, citizenship copies and certificates will be kept here.
        </div>
      ) : null}

      <EditProfileDialog
        open={dialog?.kind === "edit"}
        employee={person}
        onClose={() => setDialog(null)}
        onSaved={() => {
          setDialog(null);
          setToast({ text: "Profile updated." });
        }}
      />
      <ReviseSalaryDialog
        open={dialog?.kind === "revise"}
        employee={person}
        current={current}
        onClose={() => setDialog(null)}
        onSaved={(s: SalaryStructure) => {
          setDialog(null);
          setToast({ text: `Salary structure saved: ${formatRs(s.gross)} from ${formatBs(s.effective_from.bs)}.` });
        }}
      />
      <PhotoDialog open={dialog?.kind === "photo"} employee={person} onClose={() => setDialog(null)} onChanged={(text) => setToast({ text })} />
      <BarcodeDialog open={dialog?.kind === "barcode"} employee={person} onClose={() => setDialog(null)} />
      {dialog?.kind === "advance" ? (
        <AdvanceDialog
          open
          employee={person}
          manageModes={isAdmin}
          onClose={() => setDialog(null)}
          onOpenLedger={() => {
            setDialog(null);
            onTab("ledger");
          }}
        />
      ) : null}
      {dialog?.kind === "payment" ? (
        <PaymentDialog
          open
          employee={person}
          purpose={dialog.purpose}
          month={dialog.month}
          preferBank={current?.paid_by === "bank"}
          manageModes={isAdmin}
          onClose={() => setDialog(null)}
          onSaved={(result) => {
            setDialog(null);
            const p = result.payment;
            setToast({
              text: `${p.type === "advance" ? "Advance" : "Salary payment"} of ${formatRs(p.amount)} for ${monthLabel(p.month)} recorded (${p.receipt_no}) · due now ${formatRs(result.due_after)} · shows in Payment reports.`,
            });
          }}
        />
      ) : null}
    </>
  );
}

function OverviewTab({ employee: e, structure, ledger }: { employee: Employee; structure: SalaryStructure | null; ledger: MonthLedger[] }) {
  const running = ledger.find((l) => l.in_progress) ?? null;
  const balance = ledger.reduce((sum, l) => sum + l.due, 0);
  const rows: [string, ReactNode][] = [
    ["Employee ID", `${e.code} · barcode ${e.barcode}`],
    ["Name in Nepali", e.full_name_np ?? "—"],
    ["Branch", e.branch.name],
    ["Department", e.department?.name ?? "—"],
    ["Designation", e.designation ?? "—"],
    ["Phone", e.phone ? `+977 ${e.phone}` : "—"],
    ["Extra contact", e.phone_alt ?? "—"],
    ["Address", e.address ?? "—"],
    ["Joined", <BSDateText key="joined" value={e.joined.bs} inline />],
    ["Salary paid to", structure ? (structure.paid_by === "bank" ? "Bank" : "Cash") : "—"],
    ["App login", e.login ? `${e.login.username} (${e.login.role_label.toLowerCase()})` : "none"],
    ["Status", e.active ? "Active" : "Inactive"],
  ];
  return (
    <div className={styles.twoCards}>
      <section aria-label="Profile details" className={`card ${styles.structure}`}>
        <h3 className={shared.cardTitle} style={{ paddingBottom: 6 }}>
          Profile
        </h3>
        <div className={styles.structureGrid}>
          {rows.map(([k, v]) => (
            <div key={k} className={shared.kv}>
              <span className={shared.muted}>{k}</span>
              <span style={{ textAlign: "right" }} lang={k === "Name in Nepali" ? "ne" : undefined}>
                {v}
              </span>
            </div>
          ))}
        </div>
      </section>
      <section aria-label="This month" className={`card ${styles.advances}`}>
        <h3 className={shared.cardTitle}>This month</h3>
        <div className={shared.tiles3}>
          <div className={shared.tile} data-tone="ok">
            <span className={shared.tileLabel}>{structure?.pay_type === "daily" ? "Daily wage" : "Monthly salary"}</span>
            <span className={shared.tileValue}>{structure ? formatRs(structure.pay_type === "daily" ? structure.basic : structure.gross) : "—"}</span>
          </div>
          <div className={shared.tile} data-tone="ot">
            <span className={shared.tileLabel}>Overtime · {running ? monthName(running.month) : monthName(currentMonth())}</span>
            <span className={shared.tileValue}>{running ? `${running.attendance.overtime_hours} h` : "0 h"}</span>
          </div>
          <div className={shared.tile} data-tone={balance > 0 ? "danger" : "plain"}>
            <span className={shared.tileLabel}>Balance due</span>
            <span className={shared.tileValue}>{formatRs(balance)}</span>
          </div>
        </div>
        {running ? (
          <span className={shared.note} style={{ fontSize: 13 }}>
            {monthLabel(running.month)} so far: {formatDays(running.attendance.present)} present, {running.attendance.absent} absent, net{" "}
            {formatRs(running.net)} of which {formatRs(running.paid)} already paid.
          </span>
        ) : null}
      </section>
    </div>
  );
}

function AttendanceTab({ employee }: { employee: Employee }) {
  const month = currentMonth();
  const attendance = usePayroll(() => getAttendance(employee.id, month), [employee.id]);
  const a = attendance.data?.summary;
  return (
    <section aria-label="Attendance this month" className={`card ${styles.structure}`}>
      <div className={shared.between} style={{ paddingBottom: 6 }}>
        <h3 className={shared.cardTitle}>Attendance · {monthLabel(month)}</h3>
        <Link href="/attendance/report" className="btn btn--sm">
          Attendance report
        </Link>
      </div>
      {a ? (
        <div className={styles.attGrid}>
          {[
            ["Days so far", `${a.present + a.absent + a.weekly_off} / ${a.days_in_month}`, ""],
            ["Present", formatDays(a.present), "days marked P"],
            ["Overtime", `${a.overtime_days} d · ${a.overtime_hours} h`, "paid per hour"],
            ["Absent", String(a.absent), "unpaid days"],
            ["Weekly off", String(a.weekly_off), "Saturdays, paid"],
            ["Paid days", formatDays(a.paid_days), ""],
          ].map(([k, v, hint]) => (
            <div key={k} className={`card ${styles.attCard}`}>
              <span className={styles.attLabel}>{k}</span>
              <span className={styles.attValue}>{v}</span>
              {hint ? <span className={styles.attHint}>{hint}</span> : null}
            </div>
          ))}
        </div>
      ) : (
        <p className={shared.muted}>Loading…</p>
      )}
      <span className={shared.note}>
        Marks come from the attendance module (P present, O overtime, A absent; Saturday is the weekly off). The day-by-day
        calendar is not designed yet.
      </span>
    </section>
  );
}

function SalaryStructureCard({ structure, onRevise }: { structure: SalaryStructure | null; onRevise: () => void }) {
  return (
    <section aria-labelledby="struct-h" className={`card ${styles.structure}`}>
      <div className={shared.between} style={{ paddingBottom: 6 }}>
        <h3 id="struct-h" className={shared.cardTitle}>
          Salary structure
        </h3>
        <button type="button" className="btn btn--ghost" onClick={onRevise}>
          Revise
        </button>
      </div>
      {structure ? (
        <>
          <div className={styles.structureGrid}>
            <div className={shared.kv}>
              <span>{structure.pay_type === "monthly" ? "Basic salary" : "Daily wage"}</span>
              <span className={shared.num}>
                {formatAmount(structure.basic)}
                {structure.pay_type === "daily" ? " / day" : ""}
              </span>
            </div>
            <div className={shared.kv}>
              <span>Allowances</span>
              <span className={shared.num}>{formatAmount(structure.allowances)}</span>
            </div>
            <div className={shared.kv}>
              <span className={shared.kvStrong}>Gross</span>
              <span className={`${shared.num} ${shared.kvStrong}`}>
                {formatRs(structure.gross)}
                {structure.pay_type === "daily" ? " / day" : " / month"}
              </span>
            </div>
            <div className={shared.kv}>
              <span>Pay type</span>
              <span>{structure.pay_type === "monthly" ? "Monthly salary" : "Daily wage"}</span>
            </div>
            <div className={shared.kv}>
              <span>Overtime rate</span>
              <span className={shared.num}>{formatRs(structure.ot_rate)} / hour</span>
            </div>
            <div className={shared.kv}>
              <span>Paid by</span>
              <span>{structure.paid_by === "bank" ? "Bank" : "Cash"}</span>
            </div>
          </div>
          <div className={`${shared.kv} ${shared.kvMuted}`}>
            <span>
              Effective from <BSDateText value={structure.effective_from.bs} inline />
              {structure.previous_gross !== null ? ` · previous ${formatRs(structure.previous_gross)}` : ""}
              {structure.reason ? ` · ${structure.reason}` : ""}
            </span>
          </div>
        </>
      ) : (
        <p className={shared.muted}>No salary structure yet.</p>
      )}
    </section>
  );
}

function AdvancesCard({ ledger, onGiveAdvance }: { ledger: MonthLedger[]; onGiveAdvance: () => void }) {
  const advances: { payment: Payment; month: BsMonth }[] = ledger
    .flatMap((l) => l.payments.filter((p) => p.type === "advance").map((payment) => ({ payment, month: l.month })))
    .sort((a, b) => b.payment.date.bs.localeCompare(a.payment.date.bs) || b.payment.id - a.payment.id)
    .slice(0, 8);
  return (
    <section aria-labelledby="adv-h" className={`card ${styles.advances}`}>
      <div className={shared.between}>
        <h3 id="adv-h" className={shared.cardTitle}>
          Advances
        </h3>
        <button type="button" className="btn btn--ghost" onClick={onGiveAdvance}>
          Give advance
        </button>
      </div>
      <span className={shared.note} style={{ fontSize: 13, lineHeight: 1.5 }}>
        An advance is part of that month&apos;s salary paid early. It shows as a payment in the ledger and reduces the
        balance due — nothing is carried to later months.
      </span>
      <div style={{ display: "flex", flexDirection: "column", fontSize: 14 }}>
        {advances.length === 0 ? (
          <p className={shared.muted} style={{ fontSize: 13 }}>
            No advances given.
          </p>
        ) : (
          advances.map(({ payment, month }) => (
            <div key={payment.id} className={shared.kv}>
              <span>
                {formatBs(payment.date.bs)} · {monthName(month)} advance ({payment.payment_mode.name.toLowerCase()})
              </span>
              <span className={shared.num}>{formatRs(payment.amount)}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
