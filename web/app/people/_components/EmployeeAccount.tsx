"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pill } from "@/components/ui/Pill";
import { Avatar } from "./Avatar";
import { Barcode, downloadBarcodePng } from "./Barcode";
import { EditProfileDialog } from "./EditProfileDialog";
import { LedgerTable } from "./LedgerTable";
import { PaymentDialog } from "./PaymentDialog";
import { PhotoDialog } from "./PhotoDialog";
import { ReviseSalaryDialog } from "./ReviseSalaryDialog";
import { currentMonth, getEmployee, getLedger, getSalaryStructure, suggestPayMonth } from "../api";
import { formatBsLong, formatDateBoth, monthLabel, monthName, sameMonth } from "../_lib/calendar";
import { formatAmount, formatRs } from "../_lib/helpers";
import { PayrollIcon } from "./icons";
import type { BsMonth, Employee, MonthLedger, Payment, SalaryStructure } from "../types";
import { payrollErrorMessage, usePayroll } from "../_lib/usePayroll";
import styles from "./employees.module.css";
import shared from "./payroll.module.css";

type Dialog =
  | { kind: "edit" }
  | { kind: "revise" }
  | { kind: "photo" }
  | { kind: "payment"; purpose: "salary" | "advance" | "record"; month: BsMonth };

export function EmployeeAccount({ id }: { id: number }) {
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
  const meta = [person.designation, person.department?.name, person.branch.name, person.code].filter(Boolean).join(" · ");

  return (
    <>
      <div className={styles.topRow}>
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
              <div className={styles.profileMeta}>
                <span>Joined {formatDateBoth(person.joined)}</span>
                <span>Phone {person.phone ? `+977 ${person.phone}` : "—"}</span>
                <span>Extra contact {person.phone_alt ?? "—"}</span>
                <span>Address {person.address ?? "—"}</span>
                <span>
                  Login{" "}
                  {person.login ? `${person.login.username} · ${person.login.role_label}` : "none"}
                </span>
              </div>
            </div>
          </div>
          <div className={styles.profileActions}>
            <button type="button" className="btn" onClick={() => setDialog({ kind: "edit" })}>
              Edit profile
            </button>
            <button type="button" className="btn" onClick={() => setDialog({ kind: "payment", purpose: "advance", month: currentMonth() })}>
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

        <BarcodeCard employee={person} />
      </div>

      {toast ? (
        <p className={toast.error ? `${shared.toast} ${shared.toastError}` : shared.toast} role="status">
          {toast.text}
        </p>
      ) : null}

      <div className={styles.twoCards}>
        <SalaryStructureCard structure={structure.data?.current ?? null} onRevise={() => setDialog({ kind: "revise" })} />
        <AdvancesCard
          ledger={ledger.data ?? []}
          onGiveAdvance={() => setDialog({ kind: "payment", purpose: "advance", month: currentMonth() })}
        />
      </div>

      <LedgerTable
        employee={person}
        ledger={ledger.data ?? []}
        onRecordPayment={(m) => setDialog({ kind: "payment", purpose: "record", month: m })}
      />

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
        current={structure.data?.current ?? null}
        onClose={() => setDialog(null)}
        onSaved={(s: SalaryStructure) => {
          setDialog(null);
          setToast({ text: `Salary structure saved: ${formatRs(s.gross)} from ${formatBsLong(s.effective_from.bs)}.` });
        }}
      />
      <PhotoDialog
        open={dialog?.kind === "photo"}
        employee={person}
        onClose={() => setDialog(null)}
        onChanged={(text) => setToast({ text })}
      />
      {dialog?.kind === "payment" ? (
        <PaymentDialog
          open
          employee={person}
          purpose={dialog.purpose}
          month={dialog.month}
          onClose={() => setDialog(null)}
          onSaved={(result) => {
            setDialog(null);
            const p = result.payment;
            setToast({
              text: `${p.type === "advance" ? "Advance" : "Salary payment"} of ${formatRs(p.amount)} for ${monthLabel(p.month)} recorded · due now ${formatRs(result.due_after)} · shows in Payments.`,
            });
          }}
        />
      ) : null}
    </>
  );
}

function BarcodeCard({ employee }: { employee: Employee }) {
  return (
    <section aria-label="Employee barcode" className={`card ${styles.barcodeCard}`}>
      <div className={styles.barcodeHead}>
        <h3 className={shared.cardTitle} style={{ fontSize: 14 }}>
          Employee barcode
        </h3>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => downloadBarcodePng(employee.barcode, employee.full_name, `${employee.barcode}.png`)}
        >
          Download PNG
        </button>
      </div>
      <Barcode value={employee.barcode} label={`Barcode ${employee.barcode}`} className={styles.barcodeSvg} height={56} />
      <span className={styles.barcodeValue}>{employee.barcode}</span>
      <span className={styles.barcodeName}>{employee.full_name}</span>
      <span className={styles.barcodeNote}>
        Code 128, scanned at attendance. Stickers are printed by admin (
        <Link href="/admin/barcodes">Admin › Barcodes</Link>).
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
              Effective from {formatBsLong(structure.effective_from.bs)}
              {structure.previous_gross !== null ? ` · previous ${formatRs(structure.previous_gross)}` : ""}
              {structure.reason ? ` · ${structure.reason}` : ""}
            </span>
            <span style={{ whiteSpace: "nowrap" }}>{structure.effective_from.ad}</span>
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
  const thisMonthAdvance = ledger.find((l) => sameMonth(l.month, currentMonth()))?.advance_paid ?? 0;
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
      <span className={shared.note} style={{ fontSize: 13 }}>
        An advance is part of that month&apos;s salary: it reduces what is due, nothing is recovered later.
        {thisMonthAdvance > 0 ? ` ${formatRs(thisMonthAdvance)} given against ${monthName(currentMonth())}.` : ""}
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
                {formatBsLong(payment.date.bs)}
                <span className={shared.note}> · for {monthName(month)} · {payment.mode === "bank" ? "Bank" : "Cash"}</span>
              </span>
              <span className={shared.num}>{formatAmount(payment.amount)}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
