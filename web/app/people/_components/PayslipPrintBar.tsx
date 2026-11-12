"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import {
  DEFAULT_PER_PAGE,
  PER_PAGE_OPTIONS,
  loadPerPage,
  pageCount,
  pagesLabel,
  payslipsHref,
  printLabel,
  savePerPage,
  selectedLabel,
  unmarkedSlipWarning,
  type PerPage,
} from "../_lib/payslipSelection";
import type { BsMonth, ReportRow } from "../types";
import styles from "./report.module.css";

export interface PayslipPrintBarProps {
  /** The ticked employees in the table's sort order (= the order the slips print in). */
  rows: ReportRow[];
  /** Rows the table shows now (department chip + search): "Select all {n}". */
  shownCount: number;
  branchId: number | null;
  month: BsMonth;
  /** Remembers "slips per A4 page" for this user. */
  userId: number | null;
  onSelectShown: () => void;
  onClear: () => void;
  /** A preview / print tab was opened: the report refetches when this tab gets the focus back. */
  onOpened: () => void;
}

/**
 * Above the Payroll sheet (design/payslips/SalaryReportPayslips): a dashed hint while nothing is
 * ticked, else the teal print bar - how many slips, slips per A4 page, office copy, the page
 * count, Clear / Preview / Print - and an amber line when a ticked employee has unmarked days.
 */
export function PayslipPrintBar({ rows, shownCount, branchId, month, userId, onSelectShown, onClear, onOpened }: PayslipPrintBarProps) {
  const [perPage, setPerPage] = useState<PerPage>(DEFAULT_PER_PAGE);
  const [officeCopy, setOfficeCopy] = useState(false);
  // After mount (localStorage is not there while the page is rendered on the server).
  useEffect(() => setPerPage(loadPerPage(userId)), [userId]);

  if (rows.length === 0) {
    return (
      <div className={`${styles.slipHint} ${styles.noPrint}`}>
        <span className={styles.slipHintText}>
          <Icon name="print" size={18} />
          Tick employees to print their pay slips
        </span>
        <button type="button" className="btn" disabled={shownCount === 0} onClick={onSelectShown}>
          Select all {shownCount}
        </button>
      </div>
    );
  }

  const pick = (n: PerPage) => {
    setPerPage(n);
    savePerPage(userId, n);
  };
  const link = branchId === null ? null : { branchId, month, ids: rows.map((row) => row.employee.id), perPage, officeCopy };
  const warning = unmarkedSlipWarning(rows);

  return (
    <div className={`${styles.slipBarWrap} ${styles.noPrint}`}>
      <div role="region" aria-label="Pay slip print queue" className={styles.slipBar}>
        <div className={styles.slipBarGroup}>
          <span className={styles.slipCount} aria-live="polite">
            {selectedLabel(rows.length)}
          </span>
          <div role="group" aria-label="Slips per A4 page" className={styles.slipPer}>
            <span>Slips per A4 page</span>
            <span className={styles.slipSeg}>
              {PER_PAGE_OPTIONS.map((n) => (
                <button key={n} type="button" className={styles.slipSegOption} aria-pressed={perPage === n} onClick={() => pick(n)}>
                  {n}
                </button>
              ))}
            </span>
          </div>
          <label className={styles.slipOffice}>
            <input type="checkbox" checked={officeCopy} onChange={(event) => setOfficeCopy(event.target.checked)} />
            Office copy too
          </label>
        </div>
        <div className={styles.slipBarActions}>
          <span className={styles.slipPages}>{pagesLabel(pageCount(rows.length, perPage, officeCopy))}</span>
          <button type="button" className="btn" onClick={onClear}>
            Clear
          </button>
          {link ? (
            <>
              <a className="btn" href={payslipsHref(link)} target="_blank" rel="noopener" onClick={onOpened}>
                Preview
              </a>
              <a className="btn btn--primary" href={payslipsHref({ ...link, print: true })} target="_blank" rel="noopener" onClick={onOpened}>
                <Icon name="print" size={18} />
                {printLabel(rows.length)}
              </a>
            </>
          ) : null}
        </div>
      </div>
      {warning ? (
        <p role="status" className={styles.slipWarning} data-testid="slip-unmarked-warning">
          {warning}
        </p>
      ) : null}
    </div>
  );
}
