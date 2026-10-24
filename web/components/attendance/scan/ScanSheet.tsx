"use client";

import { useEffect, useId, useRef } from "react";
import { monthName, toDevanagariDigits } from "../bsdate";
import { CheckIcon } from "../icons";
import { draftText, formatAmount, formatRs, initials } from "../helpers";
import type { PaymentEntry } from "../types";
import { useDialog } from "../useDialog";
import type { MarkState } from "../useMarkState";
import { amountError, amountOf, type Scan } from "./scanFlow";
import styles from "./scan.module.css";

const OT_QUICK = [1, 2, 3, 4, 5, 6];
const ADVANCE_QUICK: [string, string][] = [
  ["500", "Rs 500"],
  ["1000", "Rs 1,000"],
  ["1500", "Rs 1,500"],
  ["2000", "Rs 2,000"],
  ["custom", "Custom"],
];

type Step<S extends Scan["step"]> = Extract<Scan, { step: S }>;

/**
 * The sheets of the scan loop (design/scanner/AttendanceScan*.dc.html): card
 * read → Present / Overtime; already marked → Salary / Advance → amount →
 * history; no employee found; saved (3 s countdown back to the scanner).
 * Desktop: dialog near the top; phone: bottom sheet over the camera.
 */
export function ScanSheet({ state, phone }: { state: MarkState; phone: boolean }) {
  const scan = state.scan!;
  const flow = state.flow;
  const titleId = useId();
  const countdown = scan.step === "done" || scan.step === "paid";
  // Desktop keeps the USB box focused during the countdown so the next card is read at once.
  const dialog = useDialog(() => flow.back(), { autoFocus: !(countdown && !phone) });
  return (
    <div className={`${styles.sheetBackdrop} ${phone ? styles.sheetBackdropPhone : ""}`}>
      <div
        ref={dialog.ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`${styles.sheet} ${phone ? styles.sheetPhone : ""}`}
        onKeyDown={dialog.onKeyDown}
      >
        {scan.step === "found" ? <Found scan={scan} state={state} titleId={titleId} /> : null}
        {scan.step === "already" ? <Already scan={scan} state={state} titleId={titleId} /> : null}
        {scan.step === "pay" ? <Pay scan={scan} state={state} titleId={titleId} /> : null}
        {scan.step === "history" ? <History scan={scan} state={state} titleId={titleId} /> : null}
        {scan.step === "missing" ? <Missing scan={scan} state={state} titleId={titleId} /> : null}
        {scan.step === "done" ? <Done scan={scan} state={state} titleId={titleId} phone={phone} /> : null}
        {scan.step === "paid" ? <Paid scan={scan} state={state} titleId={titleId} phone={phone} /> : null}
      </div>
    </div>
  );
}

type StepProps<S extends Scan["step"]> = { scan: Step<S>; state: MarkState; titleId: string };

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" aria-label="Close" className={styles.close} onClick={onClick}>
      ×
    </button>
  );
}

function SkipButton({ onClick, label = "Cancel · skip this person" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className={styles.skipBtn} onClick={onClick}>
      {label}
    </button>
  );
}

function BackChevron() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

function Person({ scan, titleId, size = 64 }: { scan: Step<"found" | "already">; titleId: string; size?: number }) {
  const e = scan.emp;
  return (
    <div className={styles.person}>
      <span className={styles.avatar} style={{ width: size, height: size }} aria-hidden="true">
        {initials(e.name)}
      </span>
      <div className={styles.personText}>
        <h2 id={titleId} className={styles.personName}>
          {e.name}
        </h2>
        <span className={styles.personMeta}>
          {e.code} · {e.department_name} · {e.branch_name}
        </span>
        {scan.step === "already" ? <span className={styles.personToday}>Today: {todayText(scan)}</span> : null}
      </div>
    </div>
  );
}

function todayText(scan: Step<"found" | "already">): string {
  const d = scan.current;
  if (d.status === "O") return `Present + ${d.ot_hours} h overtime`;
  return draftText(d);
}

function Found({ scan, state, titleId }: StepProps<"found">) {
  const flow = state.flow;
  const marked = scan.current.status !== null;
  const ot = scan.mode === "ot";
  return (
    <>
      <div className={`${styles.tag} ${styles.tagOk}`}>
        <CheckIcon size={16} />
        Card read · <span className="mono">{scan.code}</span>
        <CloseButton onClick={flow.skip} />
      </div>
      <Person scan={scan} titleId={titleId} />
      <span className={`${styles.now} ${marked ? styles.nowMarked : styles.nowOpen}`}>
        {marked ? `Already marked today: ${todayText(scan)} — choosing again will update it` : "Not marked yet today"}
      </span>
      {!ot ? (
        <div className={styles.twoBig}>
          <button
            type="button"
            className={`${styles.big} ${styles.bigPresent}`}
            onClick={flow.present}
            disabled={scan.busy}
            data-autofocus=""
          >
            <span className={styles.bigGlyph}>✓</span>
            <span className={styles.bigLabel}>Present</span>
            <span className={styles.bigNp} lang="ne">
              हाजिर
            </span>
          </button>
          <button
            type="button"
            className={`${styles.big} ${styles.bigOt}`}
            onClick={() => flow.otMode(true)}
            disabled={scan.busy}
          >
            <span className={styles.bigGlyph}>+</span>
            <span className={styles.bigLabel}>Overtime</span>
            <span className={styles.bigNp} lang="ne">
              ओभरटाइम
            </span>
          </button>
        </div>
      ) : (
        <div className={styles.otBox}>
          <div className={styles.otBoxHead}>
            <span>How many overtime hours?</span>
          </div>
          <div role="radiogroup" aria-label="Overtime hours" className={styles.hourChips}>
            {OT_QUICK.map((h) => (
              <button
                key={h}
                type="button"
                role="radio"
                aria-checked={scan.hours === h}
                className={styles.hourChip}
                onClick={() => flow.setHours(h)}
                data-autofocus={scan.hours === h ? "" : undefined}
              >
                {h} h
              </button>
            ))}
          </div>
          <button type="button" className={styles.saveOt} onClick={flow.saveOvertime} disabled={scan.busy}>
            {scan.busy ? "Saving…" : `Save present + ${scan.hours} h`}
          </button>
        </div>
      )}
      {scan.error ? (
        <p role="alert" className={styles.error}>
          {scan.error}
        </p>
      ) : null}
      {ot ? (
        <button type="button" className={styles.skipBtn} onClick={flow.otBack}>
          <BackChevron />
          Back
        </button>
      ) : (
        <SkipButton onClick={flow.skip} />
      )}
    </>
  );
}

function Already({ scan, state, titleId }: StepProps<"already">) {
  const flow = state.flow;
  return (
    <>
      <div className={`${styles.tag} ${styles.tagBlue}`}>
        <CheckIcon size={16} />
        Already marked today · <span className="mono">{scan.code}</span>
        <CloseButton onClick={flow.skip} />
      </div>
      <Person scan={scan} titleId={titleId} size={60} />
      <span className={styles.question}>What do you want to record?</span>
      <div className={styles.twoBig}>
        <button
          type="button"
          className={`${styles.big} ${styles.bigPresent} ${styles.bigPay}`}
          onClick={() => flow.choosePayment("salary")}
          data-autofocus=""
        >
          <span className={styles.bigLabel}>Salary payment</span>
          <span className={styles.bigNp} lang="ne">
            तलब भुक्तानी
          </span>
        </button>
        <button
          type="button"
          className={`${styles.big} ${styles.bigOt} ${styles.bigPay}`}
          onClick={() => flow.choosePayment("advance")}
        >
          <span className={styles.bigLabel}>Advance payment</span>
          <span className={styles.bigNp} lang="ne">
            पेश्की भुक्तानी
          </span>
        </button>
      </div>
      <button type="button" className={styles.changeLink} onClick={flow.changeAttendance}>
        Change today&apos;s attendance instead
      </button>
      <SkipButton onClick={flow.skip} />
    </>
  );
}

function paymentsCount(history: PaymentEntry[] | null): string {
  if (!history) return "…";
  const n = history.length;
  return n === 0 ? "no payments" : `${n} ${n === 1 ? "payment" : "payments"}`;
}

function Pay({ scan, state, titleId }: StepProps<"pay">) {
  const flow = state.flow;
  const b = scan.balance;
  const salary = scan.type === "salary";
  const typeLabel = salary ? "Salary payment" : "Advance payment";
  const amount = amountOf(scan);
  const validation = amountError(scan);
  const showError = scan.pick !== null && (scan.pick !== "custom" || scan.amount !== "") && validation !== null;
  const ok = validation === null && !!b;
  const quick: [string, string][] = salary
    ? [
        ["full", `Full due · ${b ? formatRs(b.due) : "…"}`],
        ["custom", "Custom amount"],
      ]
    : ADVANCE_QUICK;
  const month = b?.month_label ?? "this month";
  return (
    <>
      <div className={styles.payHead}>
        <button type="button" className={styles.backBtn} onClick={flow.payBack}>
          ‹ Back
        </button>
        <span className={`${styles.payPill} ${salary ? styles.payPillSalary : styles.payPillAdvance}`}>{typeLabel}</span>
        <CloseButton onClick={flow.skip} />
      </div>
      <div className={styles.personText}>
        <h2 id={titleId} className={styles.personName}>
          {scan.emp.name}
        </h2>
        <span className={styles.personMeta}>
          {typeLabel} for {month} · due {b ? formatRs(b.due) : "…"}
        </span>
      </div>
      {salary && b ? (
        <div className={styles.breakdown}>
          <div>
            <span>{month.split(" ")[0]} net salary</span>
            <span className="mono">{formatRs(b.net)}</span>
          </div>
          <div className={styles.breakdownPaid}>
            <span>Already paid (advances / part)</span>
            <span className="mono">− {formatRs(b.paid)}</span>
          </div>
          <div className={styles.breakdownDue}>
            <span>Balance due</span>
            <span className="mono">{formatRs(b.due)}</span>
          </div>
        </div>
      ) : null}
      <span className={styles.fieldLabel}>Amount</span>
      <div role="radiogroup" aria-label="Amount" className={styles.amountGrid}>
        {quick.map(([key, label], i) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={scan.pick === key}
            className={`${styles.amountChip} ${salary ? styles.amountChipWide : ""} ${salary ? styles.amountChipTeal : styles.amountChipBlue}`}
            onClick={() => flow.setPick(key)}
            data-autofocus={i === 0 ? "" : undefined}
          >
            {label}
          </button>
        ))}
      </div>
      {scan.pick === "custom" ? (
        <div className={`${styles.amountBox} ${scan.amount && !ok ? styles.amountBoxBad : ""}`}>
          <span className={styles.amountRs}>Rs</span>
          <CustomAmountInput value={scan.amount} onChange={flow.setAmount} />
        </div>
      ) : null}
      {showError || scan.error ? (
        <span className={styles.error} role="alert">
          {scan.error ?? validation}
        </span>
      ) : null}
      <button type="button" className={styles.histCard} onClick={flow.openHistory}>
        <span className={styles.histCardText}>
          <span className={styles.histCardLabel}>
            Paid in {month} · {paymentsCount(scan.history)}
          </span>
          <span className={styles.histCardAmount}>{b ? formatRs(b.paid) : "…"}</span>
        </span>
        <span className={styles.histCardLink}>History ›</span>
      </button>
      <button
        type="button"
        className={`${styles.paySave} ${salary ? styles.paySaveTeal : styles.paySaveBlue}`}
        disabled={!ok || scan.busy}
        onClick={flow.savePayment}
      >
        {scan.busy ? "Saving…" : `Save ${salary ? "salary" : "advance"}${ok ? ` · ${formatRs(amount)}` : ""}`}
      </button>
      <SkipButton onClick={flow.skip} />
    </>
  );
}

/** Focuses itself when it appears (the custom pick), without stealing focus afterwards. */
function CustomAmountInput({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <input
      ref={ref}
      inputMode="numeric"
      aria-label="Custom amount"
      placeholder="Type amount"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function dayNote(p: PaymentEntry, todayBs: string | undefined): string {
  if (p.bs_date === todayBs) {
    const age = Date.now() - Date.parse(p.created_at);
    return Number.isFinite(age) && age < 10 * 60_000 ? "Today · just now" : `Today · ${p.note}`;
  }
  return p.note;
}

function History({ scan, state, titleId }: StepProps<"history">) {
  const flow = state.flow;
  const b = scan.balance;
  const rows = scan.history;
  const month = b?.month_label ?? "";
  const todayBs = state.today?.bs_date;
  return (
    <>
      <div className={styles.histHead}>
        <button type="button" className={styles.backLink} onClick={flow.historyBack} data-autofocus="">
          <BackChevron />
          Back
        </button>
        <span className={styles.monthPill}>{month}</span>
      </div>
      <div className={styles.personText}>
        <h2 id={titleId} className={styles.personName}>
          {scan.emp.name}
        </h2>
        <span className={styles.personMeta}>Payments this month</span>
      </div>
      <div className={styles.tiles}>
        <div className={`${styles.tile} ${styles.tilePaid}`}>
          <span>Total paid</span>
          <span className={styles.tileAmount}>{b ? formatRs(b.paid) : "…"}</span>
        </div>
        <div className={`${styles.tile} ${styles.tileNet}`}>
          <span>Net salary</span>
          <span className={styles.tileAmount}>{b ? formatRs(b.net) : "…"}</span>
        </div>
        <div className={`${styles.tile} ${styles.tileDue}`}>
          <span>Due</span>
          <span className={styles.tileAmount}>{b ? formatRs(b.due) : "…"}</span>
        </div>
      </div>
      <div className={styles.histListHead}>
        <span>Day by day</span>
        <span>{paymentsCount(rows)}</span>
      </div>
      {rows && rows.length === 0 ? (
        <div className={styles.histEmpty}>No salary or advance paid yet in {month}.</div>
      ) : (
        <ul className={styles.histList} aria-busy={rows === null}>
          {(rows ?? []).map((p) => (
            <li key={p.id} className={styles.histRow}>
              <span className={styles.histDate} aria-hidden="true">
                <span className={styles.histMon}>{monthName(Number(p.bs_date.slice(5, 7)))}</span>
                <span className={styles.histDay}>{Number(p.bs_date.slice(8, 10))}</span>
              </span>
              <span className={styles.histText}>
                <span className={styles.histType} data-type={p.type}>
                  {p.type === "advance" ? "Advance" : "Salary"}
                </span>
                <span className={styles.histNote}>{dayNote(p, todayBs)}</span>
              </span>
              <span className={styles.histAmount}>Rs {formatAmount(p.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className={styles.histBackPrimary} onClick={flow.historyBack}>
        Back to payment
      </button>
    </>
  );
}

function Missing({ scan, state, titleId }: StepProps<"missing">) {
  const flow = state.flow;
  return (
    <>
      <div className={styles.result}>
        <span className={`${styles.resultIcon} ${styles.resultIconBad}`}>?</span>
        <h2 id={titleId} className={styles.personName}>
          No employee found
        </h2>
        <span className={styles.missingText}>
          Code <span className={`mono ${styles.missingCode}`}>{scan.code}</span> doesn&apos;t match any active
          employee. Check the card, or type the ID.
        </span>
      </div>
      <div className={styles.twoBtns}>
        <button type="button" className={styles.secondary} onClick={flow.skip}>
          Cancel
        </button>
        <button type="button" className={styles.primary} onClick={flow.scanNext} data-autofocus="">
          Scan again
        </button>
      </div>
    </>
  );
}

function Countdown({ state, phone }: { state: MarkState; phone: boolean }) {
  const flow = state.flow;
  return (
    <>
      <div className={styles.countdown}>
        <div className={styles.progress} aria-hidden="true">
          <div className={styles.progressBar} />
        </div>
        <span className={styles.countdownText} aria-live="polite">
          {phone ? "Back to the scanner in 3 seconds…" : "Back to scanning in 3 seconds — next card can be scanned now"}
        </span>
      </div>
      <div className={styles.twoBtns}>
        <button type="button" className={styles.secondary} onClick={flow.stop}>
          Stop scanning
        </button>
        <button type="button" className={styles.primary} onClick={flow.scanNext} data-autofocus="">
          {phone ? "Scan next now" : "Scan next"}
        </button>
      </div>
    </>
  );
}

function Done({ scan, state, titleId, phone }: StepProps<"done"> & { phone: boolean }) {
  const ot = scan.status === "O";
  return (
    <>
      <div className={styles.result}>
        <span className={styles.resultIcon}>
          <CheckIcon size={30} />
        </span>
        <h2 id={titleId} className={styles.personName}>
          {scan.emp.name}
        </h2>
        <span className={styles.resultText}>{ot ? `Present + ${scan.hours} h overtime` : "Marked present"}</span>
        <span className={styles.resultNp} lang="ne">
          {ot ? `हाजिर + ओभरटाइम ${toDevanagariDigits(scan.hours)} घण्टा` : "हाजिर भयो"}
        </span>
      </div>
      <Countdown state={state} phone={phone} />
    </>
  );
}

function Paid({ scan, state, titleId, phone }: StepProps<"paid"> & { phone: boolean }) {
  const typeLabel = scan.type === "salary" ? "Salary" : "Advance";
  return (
    <>
      <div className={styles.result}>
        <span className={styles.resultIcon}>
          <CheckIcon size={30} />
        </span>
        <h2 id={titleId} className={styles.personName}>
          {scan.emp.name}
        </h2>
        <span className={styles.resultText}>
          {typeLabel} of {formatRs(scan.paid.amount)} recorded
        </span>
        <span className={styles.resultSub}>
          Cash · {scan.monthLabel} · due now {formatRs(scan.paid.due_after)} · shows in Payments
        </span>
      </div>
      <Countdown state={state} phone={phone} />
    </>
  );
}
