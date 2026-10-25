"use client";

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
import { PaySalaryDialog } from "./PaySalaryDialog";
import { PhotoDialog } from "./PhotoDialog";
import { ReviseSalaryDialog } from "./ReviseSalaryDialog";
import { TransactionsLedger } from "./TransactionsLedger";
import { AttendanceCalendarCard } from "./AccountCards";
import { LastPaymentsCard } from "./LastPaymentsCard";
import { ACCOUNT_TABS, type AccountTab } from "../_lib/account";
import { currentMonth, getEmployee, getLedger, getSalaryStructure } from "../api";
import { BSDateText } from "@/components/date";
import { formatBs } from "@/lib/bs";
import { monthLabel, monthName } from "../_lib/months";
import { formatDays, formatRs } from "../_lib/helpers";
import { PayrollIcon } from "./icons";
import type { BsMonth, Employee, MonthLedger, SalaryStructure } from "../types";
import { payrollErrorMessage, usePayroll } from "../_lib/usePayroll";
import styles from "./employees.module.css";
import shared from "./payroll.module.css";

export { ACCOUNT_TABS, isAccountTab, type AccountTab } from "../_lib/account";

type Dialog =
  | { kind: "edit" }
  | { kind: "revise" }
  | { kind: "photo" }
  | { kind: "barcode" }
  | { kind: "advance" }
  | { kind: "salary" }
  | { kind: "payment"; purpose: "record"; month: BsMonth };

export interface EmployeeAccountProps {
  id: number;
  tab: AccountTab;
  onTab: (tab: AccountTab) => void;
}

/** One employee's account: profile card, tabs, salary (attendance calendar + last payments) / ledger. */
export function EmployeeAccount({ id, tab, onTab }: EmployeeAccountProps) {
  const { user, can } = useSession();
  const isAdmin = user?.role === "admin";
  const canMoney = can("salary_advances");
  const canAttendance = can("manage_employees") || can("view_attendance_report");
  const employee = usePayroll(() => getEmployee(id), [id]);
  const structure = usePayroll(() => getSalaryStructure(id), [id]);
  const ledger = usePayroll(() => getLedger(id), [id]);
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
          <button type="button" className="btn btn--primary" onClick={() => setDialog({ kind: "salary" })}>
            Pay salary
          </button>
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
          {canAttendance || canMoney ? (
            <div className={styles.twoCards}>
              {canAttendance ? <AttendanceCalendarCard key={person.id} employee={person} structure={current} /> : null}
              {canMoney ? <LastPaymentsCard ledger={ledger.data ?? []} onOpenLedger={() => onTab("ledger")} /> : null}
            </div>
          ) : null}
          <LedgerTable
            employee={person}
            ledger={ledger.data ?? []}
            onRecordPayment={(m) => setDialog({ kind: "payment", purpose: "record", month: m })}
          />
        </>
      ) : null}

      {tab === "ledger" ? <TransactionsLedger employee={person} /> : null}

      {tab === "overview" ? <OverviewTab employee={person} structure={current} ledger={ledger.data ?? []} /> : null}

      {tab === "documents" ? (
        <div className={`card ${styles.placeholder}`}>
          Documents — not designed yet. Contracts, citizenship copies and certificates will be kept here.
        </div>
      ) : null}

      <EditProfileDialog
        open={dialog?.kind === "edit"}
        employee={person}
        salary={structure.data ?? null}
        onRevise={() => setDialog({ kind: "revise" })}
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
      {dialog?.kind === "salary" ? (
        <PaySalaryDialog
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
          preferModeId={current?.default_payment_mode_id ?? null}
          manageModes={isAdmin}
          onClose={() => setDialog(null)}
          onSaved={(result) => {
            setDialog(null);
            const p = result.payment;
            setToast({
              text: `${p.kind === "advance" ? "Advance" : "Salary payment"} of ${formatRs(p.amount)} for ${monthLabel(p.month)} recorded (${p.receipt_no}) · due now ${formatRs(result.due_after)} · shows in Payment reports.`,
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
    ["Salary paid to", structure ? structure.default_payment_mode.name : "—"],
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
