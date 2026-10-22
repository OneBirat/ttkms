"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pill } from "@/components/ui/Pill";
import { Avatar } from "./Avatar";
import { EditProfileDialog } from "./EditProfileDialog";
import { GiveAdvanceDialog } from "./GiveAdvanceDialog";
import { PhotoDialog } from "./PhotoDialog";
import { PhotoPanel } from "./PhotoPanel";
import { ReviseSalaryDialog } from "./ReviseSalaryDialog";
import { SalaryTab } from "./SalaryTab";
import { AttendanceTab } from "./AttendanceTab";
import {
  currentMonth,
  getEmployee,
  getLedger,
  getSalaryStructure,
  listAdvances,
  payEmployee,
  setEmployeePhoto,
} from "./api";
import { formatBsLong, monthName, sameMonth } from "./calendar";
import { formatRs } from "./helpers";
import { PayrollIcon } from "./icons";
import type { EmployeeProfile } from "./types";
import { payrollErrorMessage, usePayroll } from "./usePayroll";
import styles from "./employees.module.css";
import shared from "./payroll.module.css";

type Tab = "overview" | "salary" | "attendance" | "documents";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "salary", label: "Salary" },
  { id: "attendance", label: "Attendance" },
  { id: "documents", label: "Documents" },
];

export function EmployeeAccount({ id }: { id: number }) {
  const employee = usePayroll(() => getEmployee(id), [id]);
  const structure = usePayroll(() => getSalaryStructure(id), [id]);
  const advances = usePayroll(() => listAdvances(id), [id]);
  const ledger = usePayroll(() => getLedger(id), [id]);
  const [tab, setTab] = useState<Tab>("salary");
  const [dialog, setDialog] = useState<"edit" | "advance" | "revise" | "photo" | null>(null);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [paying, setPaying] = useState(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const month = currentMonth();

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
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

  const currentSlip = ledger.data?.find((p) => sameMonth(p.month, month)) ?? null;
  const payLabel = `Pay ${monthName(month)} salary`;

  const pay = async () => {
    setPaying(true);
    try {
      const slip = await payEmployee(id, month);
      setToast({ text: `${monthName(month)} salary of ${formatRs(slip.net_pay)} marked paid.` });
    } catch (err) {
      setToast({ text: payrollErrorMessage(err), error: true });
    } finally {
      setPaying(false);
    }
  };

  const removePhoto = async () => {
    if (!person.photo_url) return;
    await setEmployeePhoto(id, null);
    setToast({ text: "Photo removed." });
  };

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.findIndex((t) => t.id === tab);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    else return;
    event.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  };

  const meta = [person.designation, person.department?.name, person.branch.name, person.code]
    .filter(Boolean)
    .join(" · ");
  const loginText = person.login
    ? `Login: ${person.login.username} (${person.login.role_label.toLowerCase()})`
    : "No app login";

  return (
    <>
      <section aria-label="Profile" className={`card ${styles.profile}`}>
        <div className={styles.profileMain}>
          <div className={styles.photoWrap}>
            <Avatar name={person.full_name} photoUrl={person.photo_url} size={72} tone="profile" />
            <button
              type="button"
              className={styles.cameraButton}
              aria-label="Change photo"
              onClick={() => setDialog("photo")}
            >
              <PayrollIcon name="camera" size={16} />
            </button>
          </div>
          <div className={styles.profileText}>
            <div className={styles.nameRow}>
              <h2 className={styles.name}>{person.full_name}</h2>
              <Pill status={person.status} />
            </div>
            <span className={styles.line}>{meta}</span>
            <span className={styles.lineSmall}>
              {person.phone ?? "No phone"} · {loginText}
            </span>
          </div>
        </div>
        <div className={styles.profileActions}>
          <button type="button" className="btn" onClick={() => setDialog("edit")}>
            Edit profile
          </button>
          <button type="button" className="btn" onClick={() => setDialog("advance")}>
            Give advance
          </button>
          {currentSlip?.status === "paid" ? (
            <button type="button" className="btn btn--primary" disabled>
              {monthName(month)} salary paid
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void pay()}
              disabled={paying || !currentSlip}
            >
              {paying ? "Paying…" : payLabel}
            </button>
          )}
        </div>
      </section>

      {toast ? (
        <p className={toast.error ? `${styles.toast} ${styles.toastError}` : styles.toast} role="status">
          {toast.text}
        </p>
      ) : null}

      <PhotoPanel
        employee={person}
        onUseDevice={() => setDialog("photo")}
        onRemove={() => void removePhoto()}
      />

      <div
        role="tablist"
        aria-label="Employee sections"
        className={shared.tabs}
        onKeyDown={onTabKey}
      >
        {TABS.map((t, index) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={shared.tab}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className={shared.stack}>
        {tab === "salary" ? (
          <SalaryTab
            employee={person}
            structure={structure.data?.current ?? null}
            advances={advances.data ?? []}
            ledger={ledger.data ?? []}
            onRevise={() => setDialog("revise")}
            onGiveAdvance={() => setDialog("advance")}
          />
        ) : tab === "attendance" ? (
          <AttendanceTab employee={person} />
        ) : tab === "overview" ? (
          <OverviewTab
            employee={person}
            payLine={
              structure.data?.current
                ? structure.data.current.pay_type === "monthly"
                  ? `Monthly salary ${formatRs(structure.data.current.amount)}`
                  : `Daily wage ${formatRs(structure.data.current.amount)} per day`
                : "—"
            }
          />
        ) : (
          <EmptyState
            icon="file"
            title="No documents yet"
            text="Citizenship copy, contract and other files will be kept here."
          />
        )}
      </div>

      <EditProfileDialog
        open={dialog === "edit"}
        employee={person}
        onClose={() => setDialog(null)}
        onSaved={() => {
          setDialog(null);
          setToast({ text: "Profile updated." });
        }}
      />
      <GiveAdvanceDialog
        open={dialog === "advance"}
        employee={person}
        onClose={() => setDialog(null)}
        onSaved={(advance) => {
          setDialog(null);
          setToast({ text: `Advance of ${formatRs(advance.amount)} recorded.` });
        }}
      />
      <ReviseSalaryDialog
        open={dialog === "revise"}
        employee={person}
        current={structure.data?.current ?? null}
        onClose={() => setDialog(null)}
        onSaved={() => {
          setDialog(null);
          setToast({ text: "Salary revised. Pending payslips were recalculated." });
        }}
      />
      <PhotoDialog open={dialog === "photo"} employee={person} onClose={() => setDialog(null)} />
    </>
  );
}

function OverviewTab({ employee, payLine }: { employee: EmployeeProfile; payLine: string }) {
  const rows: [string, string][] = [
    ["Employee ID", employee.code],
    ["Full name", employee.full_name],
    ["Phone", employee.phone ?? "—"],
    ["Branch", employee.branch.name],
    ["Department", employee.department?.name ?? "—"],
    ["Designation", employee.designation ?? "—"],
    ["Status", employee.status === "active" ? "Active" : "Inactive"],
    ["Pay", payLine],
    ["App login", employee.login ? `${employee.login.username} · ${employee.login.role_label}` : "None"],
    ["On record since", `${formatBsLong(employee.created_at)} BS`],
  ];
  return (
    <section aria-label="Overview" className={`card ${shared.cardPad}`}>
      {rows.map(([label, value]) => (
        <div key={label} className={shared.kv}>
          <span className={shared.muted}>{label}</span>
          <span>{value}</span>
        </div>
      ))}
      <p className={shared.note} style={{ paddingTop: 10 }}>
        Attendance and payslips for this employee are also visible to them when they sign in.{" "}
        <Link href="/attendance">Attendance module</Link>
      </p>
    </section>
  );
}
