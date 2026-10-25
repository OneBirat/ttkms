"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Avatar } from "./Avatar";
import { RecentPaymentsPanel } from "./RecentPaymentsPanel";
import { SalaryPayForm } from "./SalaryPayForm";
import { getAccountSummary } from "../api";
import type { Employee, SalaryPaymentResult } from "../types";
import { usePayroll } from "../_lib/usePayroll";
import styles from "./payroll.module.css";
import own from "./employees.module.css";
import settle from "./settle.module.css";

export interface PaySalaryDialogProps {
  open: boolean;
  employee: Employee;
  manageModes?: boolean;
  onClose: () => void;
  /** "Open full ledger ›" */
  onOpenLedger: () => void;
}

/**
 * Pay salary (desktop): the SalaryPayForm on the left, the same "Recent payments" panel as Give
 * advance on the right.
 */
export function PaySalaryDialog({ open, employee, manageModes = false, onClose, onOpenLedger }: PaySalaryDialogProps) {
  const summary = usePayroll(() => getAccountSummary(employee.id), [employee.id]);
  const [paid, setPaid] = useState<SalaryPaymentResult | null>(null);
  const meta = [employee.full_name, employee.code, employee.department?.name, employee.branch.name].filter(Boolean).join(" · ");

  return (
    <Modal open={open} title="Pay salary" onClose={onClose} size="lg">
      <div className={own.advanceGrid}>
        <div className={styles.stack} style={{ gap: 14 }}>
          <div className={settle.head}>
            <Avatar name={employee.full_name} photoUrl={employee.photo_url} size={44} tone="profile" />
            <div className={settle.headText}>
              <span className={settle.headName}>Pay salary</span>
              <span className={styles.note}>{meta}</span>
            </div>
            <span className={styles.pillSalary} lang="ne">
              तलब
            </span>
          </div>
          {open ? (
            <SalaryPayForm
              key={employee.id}
              employee={employee}
              manageModes={manageModes}
              onCancel={onClose}
              onPaid={(result) => {
                setPaid(result);
                summary.reload();
              }}
              onDone={() => {
                setPaid(null);
                onClose();
              }}
            />
          ) : null}
        </div>
        <RecentPaymentsPanel summary={summary.data} highlightIds={paid ? paid.payments.map((p) => p.id) : []} onOpenLedger={onOpenLedger} footnote={false} />
      </div>
    </Modal>
  );
}
