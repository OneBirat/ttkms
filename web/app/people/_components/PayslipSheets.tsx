"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { getPayslips, markPayslipsPrinted } from "../api";
import { monthKey, parseMonthKey } from "../_lib/months";
import { parseIds, sheetTexts, sheetsOf, slipCopies, slipText, type SheetCell, type SheetTexts, type SlipLine } from "../_lib/payslipModel";
import { PER_PAGE_OPTIONS, pageCount, pagesLabel, parsePerPage, printLabel, type PerPage } from "../_lib/payslipSelection";
import { payrollErrorMessage } from "../_lib/usePayroll";
import type { Payslips } from "../types";
import styles from "./payslips.module.css";

/** A4 at 96 dpi: the sheet's width on screen, for fitting the preview to a narrow window. */
const SHEET_PX = 794;
/** Scale steps tried, in order, for a slip that is taller than its cell. */
const FIT_STEPS = [0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65];

/**
 * /people/salary/payslips?branch&month&ids&per=4|6|8&office=0|1[&print=1]: the ticked employees'
 * pay slips on A4 sheets (design/payslips/PaySlipSheet4 / 6 / 8). With print=1 the browser's
 * print dialog opens once the slips and fonts are ready, and the print is remembered
 * (POST /payslips/printed) - whether the dialog is then cancelled cannot be known.
 */
export function PayslipSheets() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const branchId = Number(params.get("branch"));
  const monthParam = params.get("month") ?? "";
  const idsParam = params.get("ids");
  const perPage = parsePerPage(params.get("per"));
  const officeCopy = params.get("office") === "1";
  const autoPrint = params.get("print") === "1";
  const month = useMemo(() => parseMonthKey(monthParam), [monthParam]);
  const ids = useMemo(() => parseIds(idsParam), [idsParam]);
  const valid = Number.isInteger(branchId) && branchId > 0 && month !== null && ids.length > 0;

  const [data, setData] = useState<Payslips | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!valid || !month) return;
    let cancelled = false;
    getPayslips(branchId, month, ids)
      .then((value) => {
        if (!cancelled) setData(value);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(payrollErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [valid, branchId, month, ids]);

  const print = useCallback(() => {
    if (!month) return;
    // Remembered at the moment the dialog opens; a failure here must not stop the printing.
    markPayslipsPrinted(branchId, month, ids).catch(() => undefined);
    window.print();
  }, [branchId, month, ids]);

  const setParam = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      // Keep the commas of ids readable (and the URL short).
      router.replace(`${pathname}?${next.toString().replace(/%2C/g, ",")}`, { scroll: false });
    },
    [params, pathname, router],
  );

  // A slip must never be cut off or run into the next one: a slip whose text is taller than its
  // cell (many lines, a long name) is shrunk step by step until it fits.
  const sheetsRef = useRef<HTMLElement | null>(null);
  const [fitted, setFitted] = useState(0);
  useEffect(() => {
    const root = sheetsRef.current;
    if (!root || !data) return;
    let cancelled = false;
    const fit = () => {
      if (cancelled) return;
      for (const el of root.querySelectorAll<HTMLElement>("[data-slip]")) {
        el.style.zoom = "";
        for (const step of FIT_STEPS) {
          if (el.scrollHeight <= el.clientHeight + 1) break;
          el.style.zoom = String(step);
        }
      }
      setFitted((n) => n + 1);
    };
    fit();
    void (document.fonts?.ready ?? Promise.resolve()).then(fit);
    return () => {
      cancelled = true;
    };
  }, [data, perPage, officeCopy]);

  // print=1: once, when the slips are there, the fonts are loaded and every slip fits its cell.
  const autoPrinted = useRef(false);
  useEffect(() => {
    if (!data || !autoPrint || autoPrinted.current || fitted === 0) return;
    autoPrinted.current = true;
    const fonts = document.fonts?.ready ?? Promise.resolve();
    void fonts.then(() => {
      // Two frames: the fit after the fonts has been laid out and painted.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          print();
          // A reload of this tab must not print (and record) again.
          setParam({ print: null });
        }),
      );
    });
  }, [data, autoPrint, fitted, print, setParam]);

  // Preview only: shrink the sheets to the window on a phone (print is always 1:1).
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const fit = () => setZoom(Math.min(1, (window.innerWidth - 16) / SHEET_PX));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const backHref = month ? `/people/salary?month=${monthKey(month)}` : "/people/salary";
  const sheets = useMemo(() => (data ? sheetsOf(slipCopies(data.slips, officeCopy), perPage) : []), [data, officeCopy, perPage]);
  const texts = useMemo(() => (data ? sheetTexts(data) : null), [data]);
  const unmarked = data ? data.slips.filter((s) => s.unmarked_days > 0).map((s) => s.employee.name) : [];

  return (
    <div className={styles.page}>
      {/* The page box: A4, no margin - each sheet is exactly one page. */}
      <style>{`@page { size: A4 portrait; margin: 0 } @media print { html, body { background: #fff !important; margin: 0 !important; padding: 0 !important } }`}</style>
      <header className={styles.toolbar}>
        <Link href={backHref} className="btn">
          <Icon name="chevron-left" size={16} />
          Back
        </Link>
        <div role="group" aria-label="Slips per A4 page" className={styles.per}>
          <span className={styles.perLabel}>Slips per A4 page</span>
          <span className={styles.seg}>
            {PER_PAGE_OPTIONS.map((n) => (
              <button key={n} type="button" className={styles.segOption} aria-pressed={perPage === n} onClick={() => setParam({ per: String(n) })}>
                {n}
              </button>
            ))}
          </span>
        </div>
        {data ? (
          <span className={styles.summary}>
            {texts?.month} · {pagesLabel(pageCount(data.slips.length, perPage, officeCopy))}
            {officeCopy ? " · with office copies" : ""}
          </span>
        ) : null}
        <button type="button" className={`btn btn--primary ${styles.printButton}`} disabled={!data} onClick={print}>
          <Icon name="print" size={18} />
          {data ? printLabel(data.slips.length) : "Print"}
        </button>
      </header>

      {unmarked.length > 0 ? (
        <p role="status" className={styles.warning}>
          {unmarked.join(", ")} {unmarked.length === 1 ? "has" : "have"} attendance days not marked. Mark them before printing, or the slip will be wrong.
        </p>
      ) : null}

      {!valid ? (
        <p role="alert" className={styles.message}>
          This link is incomplete. Open the Salary report, tick the employees and choose Preview or Print.
        </p>
      ) : error ? (
        <p role="alert" className={styles.message}>
          {error}
        </p>
      ) : !data || !texts ? (
        <p role="status" className={styles.message}>
          Loading…
        </p>
      ) : (
        <main ref={sheetsRef} className={styles.sheets} style={{ zoom }} data-per={perPage}>
          {sheets.map((cells, index) => (
            <section key={index} className={styles.sheet} data-per={perPage} aria-label={`A4 sheet ${index + 1} of ${sheets.length}`}>
              {cells.map((cell) => (
                <Slip key={`${cell.slip.employee.id}-${cell.office ? "o" : "e"}`} cell={cell} layout={perPage} texts={texts} />
              ))}
            </section>
          ))}
        </main>
      )}
    </div>
  );
}

function Line({ line }: { line: SlipLine }) {
  return (
    <div className={styles.line}>
      <span>
        {line.label}
        {line.note ? <span className={styles.sub}> {line.note}</span> : null}
      </span>
      <span className={styles.amt}>{line.amount}</span>
    </div>
  );
}

function Slip({ cell, layout, texts }: { cell: SheetCell; layout: PerPage; texts: SheetTexts }) {
  const t = slipText(cell.slip, layout);
  const office = cell.office ? "Office copy" : null;
  const label = `Pay slip for ${t.name}${cell.office ? " (office copy)" : ""}`;
  const cut = { "data-cut-right": cell.cutRight || undefined, "data-cut-below": cell.cutBelow || undefined };

  if (layout === 4) {
    return (
      <section aria-label={label} className={styles.slip} data-slip {...cut}>
        <div className={styles.head4}>
          <div className={styles.stack}>
            <span className={styles.place4}>{texts.place}</span>
            <span className={styles.sub}>Pay slip · {texts.month}</span>
          </div>
          {office ? <span className={styles.sub}>{office}</span> : null}
        </div>
        <div className={styles.stack}>
          <span className={styles.name}>{t.name}</span>
          <span className={styles.sub}>{t.sub}</span>
        </div>
        <div className={styles.strip}>
          <div className={styles.stripCell}>
            <span className={styles.sub}>Paid days</span>
            <span className={styles.stripValue}>{t.paidDays}</span>
          </div>
          {t.absent ? (
            <div className={styles.stripCell}>
              <span className={styles.sub}>Absent</span>
              <span className={styles.stripValue}>{t.absent.days}</span>
              <span className={styles.sub}>{t.absent.dates}</span>
            </div>
          ) : null}
          <div className={styles.stripCell}>
            <span className={styles.sub}>Overtime</span>
            <span className={styles.stripValue}>{t.overtimeHours}</span>
          </div>
        </div>
        <div className={styles.lines}>
          <Line line={t.base} />
          {t.deductions.map((d) => (
            <Line key={d.key} line={d} />
          ))}
          <Line line={t.overtime} />
          <div className={`${styles.line} ${styles.earned4}`}>
            <span>Earned this month</span>
            <span className={styles.amt}>{t.earned}</span>
          </div>
          {t.payments.map((p) => (
            <Line key={p.key} line={p} />
          ))}
          <div className={styles.balance4}>
            <span>Balance due</span>
            <span className={styles.balanceAmt}>{t.balance}</span>
          </div>
        </div>
        <div className={styles.foot4}>
          <div className={`${styles.sign} ${styles.sub}`}>
            Prepared by
            <br />
            {texts.printed}
          </div>
          <div className={`${styles.sign} ${styles.sub}`}>Received by · date</div>
        </div>
      </section>
    );
  }

  if (layout === 6) {
    return (
      <section aria-label={label} className={styles.slip} data-slip {...cut}>
        <div className={styles.headRow}>
          <span className={styles.sub}>
            {texts.place} · Pay slip{office ? ` · ${office}` : ""}
          </span>
          <span className={`${styles.sub} ${styles.nowrap}`}>{texts.month}</span>
        </div>
        <div className={styles.stack}>
          <span className={styles.name}>{t.name}</span>
          <span className={styles.sub}>{t.sub}</span>
        </div>
        <span className={styles.sub}>{t.attendanceLine}</span>
        <div className={styles.lines}>
          <Line line={t.base} />
          {t.deductions.map((d) => (
            <Line key={d.key} line={d} />
          ))}
          <Line line={t.overtime} />
          <div className={styles.line}>
            <span>Earned this month</span>
            <span className={styles.amt}>{t.earned}</span>
          </div>
          {t.payments.map((p) => (
            <Line key={p.key} line={p} />
          ))}
          <div className={`${styles.line} ${styles.balanceRule}`}>
            <span className={styles.balanceLabel}>Balance due</span>
            <span className={styles.balanceAmt}>{t.balance}</span>
          </div>
        </div>
        <div className={styles.footRow}>
          <span className={styles.sub}>Received by</span>
          <span className={styles.rule} />
          <span className={styles.sub}>Date</span>
          <span className={styles.ruleDate} />
        </div>
      </section>
    );
  }

  return (
    <section aria-label={label} className={styles.slip} data-slip {...cut}>
      <div className={styles.headRow}>
        <span className={styles.name}>{t.name}</span>
        <span className={`${styles.sub} ${styles.nowrap}`}>
          {texts.business} · {texts.month}
          {office ? ` · ${office}` : ""}
        </span>
      </div>
      <span className={styles.sub}>{t.sub}</span>
      <div className={`${styles.lines} ${styles.lines8}`}>
        <Line line={t.base} />
        {t.deductions.map((d) => (
          <Line key={d.key} line={d} />
        ))}
        <Line line={t.overtime} />
        {t.payments.map((p) => (
          <Line key={p.key} line={p} />
        ))}
        <div className={`${styles.line} ${styles.balanceRule}`}>
          <span className={styles.balanceLabel}>Balance due</span>
          <span className={styles.balanceAmt}>{t.balance}</span>
        </div>
      </div>
      <div className={styles.footRow}>
        <span className={styles.sub}>Received by</span>
        <span className={styles.rule} />
      </div>
    </section>
  );
}
