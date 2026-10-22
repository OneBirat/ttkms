"use client";

import { Pill } from "@/components/ui/Pill";
import { monthsToClear } from "./calc";
import { addMonths, formatBsLong, formatBsShort, monthLabel, monthName, sameMonth } from "./calendar";
import { currentMonth } from "./api";
import { downloadText, ledgerCsv, printPayslip } from "./exports";
import { formatDeduction, formatPaidDays, formatRs } from "./helpers";
import type { Advance, EmployeeProfile, Payslip, SalaryStructure } from "./types";
import styles from "./employees.module.css";
import shared from "./payroll.module.css";

export interface SalaryTabProps {
  employee: EmployeeProfile;
  structure: SalaryStructure | null;
  advances: Advance[];
  ledger: Payslip[];
  onRevise: () => void;
  onGiveAdvance: () => void;
}

interface HistoryLine {
  key: string;
  label: string;
  amount: string;
  sortKey: string;
}

function advanceHistory(advances: Advance[]): HistoryLine[] {
  const lines: HistoryLine[] = [];
  for (const advance of advances) {
    lines.push({
      key: `a${advance.id}`,
      label: `${advance.given_on.bs} · advance taken${advance.note ? ` · ${advance.note}` : ""}`,
      amount: formatRs(advance.amount),
      sortKey: `${advance.given_on.bs}-0`,
    });
    for (const recovery of advance.recoveries) {
      lines.push({
        key: `r${recovery.id}`,
        label: `${monthName(recovery.month)} salary · recovered`,
        amount: `− ${formatRs(recovery.amount).slice(3)}`,
        sortKey: `${recovery.month.bs_year}-${String(recovery.month.bs_month).padStart(2, "0")}-99-1`,
      });
    }
  }
  return lines.sort((a, b) => b.sortKey.localeCompare(a.sortKey)).slice(0, 8);
}

export function SalaryTab({ employee, structure, advances, ledger, onRevise, onGiveAdvance }: SalaryTabProps) {
  const month = currentMonth();
  const open = advances.filter((a) => a.outstanding > 0);
  const outstanding = open.reduce((sum, a) => sum + a.outstanding, 0);
  const monthly = open.reduce((sum, a) => sum + Math.min(a.monthly_recovery, a.outstanding), 0);
  const openTotal = open.reduce((sum, a) => sum + a.amount, 0);
  const recovered = openTotal - outstanding;
  const clearsIn = monthsToClear(outstanding, monthly);
  const clearsMonth =
    Number.isFinite(clearsIn) && clearsIn > 0 ? monthName(addMonths(month, clearsIn - 1)) : null;
  const history = advanceHistory(advances);
  const latest = ledger[0] ?? null;

  const payslipPdf = (slip: Payslip | null) => {
    if (!slip) return;
    if (!printPayslip(employee, slip)) {
      window.alert("The browser blocked the payslip window. Allow pop-ups for this site and try again.");
    }
  };

  return (
    <>
      <div className={styles.twoCards}>
        <section aria-labelledby="struct-h" className={`card ${styles.structure}`}>
          <div className={shared.between} style={{ paddingBottom: 6 }}>
            <h3 id="struct-h" className={shared.cardTitle}>
              Pay structure
            </h3>
            <button type="button" className="btn btn--ghost" onClick={onRevise}>
              Revise
            </button>
          </div>
          {structure ? (
            <>
              <div className={shared.kv}>
                <span>{structure.pay_type === "monthly" ? "Monthly salary" : "Daily wage"}</span>
                <span className={`${shared.num} ${shared.kvStrong}`}>
                  {formatRs(structure.amount)}
                  {structure.pay_type === "daily" ? " / day" : ""}
                </span>
              </div>
              <div className={shared.kv}>
                <span>Paid by</span>
                <span>{structure.paid_by === "bank" ? "Bank" : "Cash"}</span>
              </div>
              <div className={shared.kv}>
                <span>Rule</span>
                <span style={{ textAlign: "right", maxWidth: "70%" }} className={shared.kvMuted}>
                  {structure.pay_type === "monthly"
                    ? "Absent days deducted; leave, Saturdays paid; half day = ½"
                    : "Wage × days present; half day = ½"}
                </span>
              </div>
              <div className={`${shared.kv} ${shared.kvMuted}`}>
                <span>
                  Effective from {structure.effective_from.bs}
                  {structure.previous_amount !== null
                    ? ` · previous ${formatRs(structure.previous_amount)}`
                    : ""}
                </span>
                <span>{structure.effective_from.ad}</span>
              </div>
            </>
          ) : (
            <p className={shared.muted}>No pay structure yet.</p>
          )}
        </section>

        <section aria-labelledby="adv-h" className={`card ${styles.advances}`}>
          <div className={shared.between}>
            <h3 id="adv-h" className={shared.cardTitle}>
              Advances
            </h3>
            <button type="button" className="btn btn--ghost" onClick={onGiveAdvance}>
              Give advance
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className={shared.note} style={{ fontSize: 13 }}>
              Outstanding
            </span>
            <span className={styles.bigNumber}>{formatRs(outstanding)}</span>
            <span className={shared.note} style={{ fontSize: 13 }}>
              {outstanding > 0
                ? `Recovering ${formatRs(monthly)} per month${clearsMonth ? ` · clears ${clearsMonth}` : ""}`
                : "Nothing outstanding"}
            </span>
          </div>
          {openTotal > 0 ? (
            <div
              className={shared.progress}
              role="img"
              aria-label={`${formatRs(recovered)} of ${formatRs(openTotal)} recovered`}
            >
              <div
                className={shared.progressBar}
                style={{ width: `${Math.round((recovered / openTotal) * 100)}%` }}
              />
            </div>
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", fontSize: 14 }}>
            {history.length === 0 ? (
              <p className={shared.muted} style={{ fontSize: 13 }}>
                No advances given.
              </p>
            ) : (
              history.map((line) => (
                <div key={line.key} className={shared.kv}>
                  <span>{line.label}</span>
                  <span className={shared.num}>{line.amount}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <section aria-labelledby="ledger-h" className={`card ${styles.ledger}`}>
        <div className={styles.ledgerHead}>
          <h3 id="ledger-h" className={shared.cardTitle}>
            Salary ledger
          </h3>
          <div className={shared.row} style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => payslipPdf(latest)}
              disabled={!latest}
              title={latest ? `Payslip for ${monthLabel(latest.month)}` : undefined}
            >
              Payslip PDF
            </button>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() =>
                downloadText(`${employee.code}-salary-ledger.csv`, ledgerCsv(employee, ledger))
              }
              disabled={ledger.length === 0}
            >
              Excel
            </button>
          </div>
        </div>
        <div className={shared.tableWrap}>
          <table className={shared.table}>
            <caption className={shared.srOnly}>Salary ledger for {employee.full_name}</caption>
            <thead>
              <tr>
                <th scope="col">Month (BS)</th>
                <th scope="col" className={shared.num}>
                  Paid days
                </th>
                <th scope="col" className={shared.num}>
                  Gross
                </th>
                <th scope="col" className={shared.num}>
                  Absence deduction
                </th>
                <th scope="col" className={shared.num}>
                  Advance
                </th>
                <th scope="col" className={shared.num}>
                  Net pay
                </th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className={shared.srOnly}>Payslip</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {ledger.length === 0 ? (
                <tr>
                  <td colSpan={8} className={shared.empty}>
                    No payslips yet.
                  </td>
                </tr>
              ) : (
                ledger.map((slip) => (
                  <tr key={slip.id}>
                    <td>
                      {monthLabel(slip.month)}
                      {sameMonth(slip.month, month) ? (
                        <span className={shared.note}> · current</span>
                      ) : null}
                    </td>
                    <td className={shared.num}>{formatPaidDays(slip.paid_days, slip.days_in_month)}</td>
                    <td className={shared.num}>{formatRs(slip.gross).slice(3)}</td>
                    <td className={shared.num}>{formatDeduction(slip.absence_deduction)}</td>
                    <td className={shared.num}>{formatDeduction(slip.advance_recovered)}</td>
                    <td className={`${shared.num} ${shared.kvStrong}`}>{formatRs(slip.net_pay).slice(3)}</td>
                    <td>
                      {slip.status === "paid" && slip.paid_on ? (
                        <Pill
                          status="paid"
                          label={`Paid ${formatBsShort(slip.paid_on.bs)}`}
                        />
                      ) : (
                        <Pill status="pending" />
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => payslipPdf(slip)}
                        aria-label={`Payslip PDF for ${monthLabel(slip.month)}`}
                      >
                        PDF
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <span className={styles.ledgerNote}>
          Monthly: absence deduction = salary ÷ days in month × unpaid days (absent = 1, half day = ½;
          leave and Saturdays are paid). Daily wage: pay = wage × days present. Paid days come from the
          attendance report. Advances are recovered automatically until cleared.
          {latest?.paid_on ? ` Last paid ${formatBsLong(latest.paid_on.bs)}.` : ""}
        </span>
      </section>
    </>
  );
}
