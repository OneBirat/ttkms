"use client";

import { useId } from "react";
import { toDevanagariDigits } from "../bsdate";
import { CheckIcon } from "../icons";
import { draftText, formatAmount, formatRs, initials, paymentError } from "../helpers";
import { useDialog } from "../useDialog";
import { scanAmount, type MarkState, type ScanState } from "../useMarkState";
import styles from "./scan.module.css";

const OT_QUICK = [1, 2, 3, 4, 5, 6];
const ADVANCE_QUICK: [string, string][] = [
  ["500", "Rs 500"],
  ["1000", "Rs 1,000"],
  ["1500", "Rs 1,500"],
  ["2000", "Rs 2,000"],
  ["custom", "Custom"],
];

/**
 * The pop-ups after a card is read (desktop: dialog near the top; phone:
 * bottom sheet): card read → Present / Overtime → saved; already marked →
 * Salary / Advance payment → saved; no employee found.
 */
export function ScanSheet({ state, phone }: { state: MarkState; phone: boolean }) {
  const scan = state.scan!;
  const titleId = useId();
  const dialog = useDialog(state.closeScan);
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
        {scan.step === "paid" ? <Paid scan={scan} state={state} titleId={titleId} /> : null}
        {scan.step === "missing" ? <Missing scan={scan} state={state} titleId={titleId} /> : null}
        {scan.step === "done" ? <Done scan={scan} state={state} titleId={titleId} /> : null}
        {scan.error && scan.step !== "pay" ? (
          <p role="alert" className={styles.error}>
            {scan.error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

type StepProps = { scan: ScanState; state: MarkState; titleId: string };

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" aria-label="Close" className={styles.close} onClick={onClick}>
      ×
    </button>
  );
}

function Person({ scan, titleId, size = 64 }: { scan: ScanState; titleId: string; size?: number }) {
  const e = scan.employee!;
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
        {scan.step === "already" ? (
          <span className={styles.personToday}>Today: {todayText(scan)}</span>
        ) : null}
      </div>
    </div>
  );
}

function todayText(scan: ScanState): string {
  const d = scan.current;
  if (d.status === "O") return `Present + ${d.ot_hours} h overtime`;
  return draftText(d);
}

function Found({ scan, state, titleId }: StepProps) {
  const marked = scan.current.status !== null;
  return (
    <>
      <div className={`${styles.tag} ${styles.tagOk}`}>
        <CheckIcon size={16} />
        Card read · <span className="mono">{scan.code}</span>
        <CloseButton onClick={state.closeScan} />
      </div>
      <Person scan={scan} titleId={titleId} />
      <span className={`${styles.now} ${marked ? styles.nowMarked : styles.nowOpen}`}>
        {marked
          ? `Already marked today: ${todayText(scan)} — choosing again will update it`
          : "Not marked yet today"}
      </span>
      {!scan.otMode ? (
        <div className={styles.twoBig}>
          <button
            type="button"
            className={`${styles.big} ${styles.bigPresent}`}
            onClick={state.scanPresent}
            disabled={scan.busy}
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
            onClick={() => state.scanOtMode(true)}
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
            <button type="button" className={styles.linkBtn} onClick={() => state.scanOtMode(false)}>
              Back
            </button>
          </div>
          <div role="radiogroup" aria-label="Overtime hours" className={styles.hourChips}>
            {OT_QUICK.map((h) => (
              <button
                key={h}
                type="button"
                role="radio"
                aria-checked={scan.hours === h}
                className={styles.hourChip}
                onClick={() => state.scanHours(h)}
              >
                {h} h
              </button>
            ))}
          </div>
          <button
            type="button"
            className={styles.saveOt}
            onClick={state.scanSaveOvertime}
            disabled={scan.busy}
          >
            {scan.busy ? "Saving…" : `Save present + ${scan.hours} h`}
          </button>
        </div>
      )}
    </>
  );
}

function Already({ scan, state, titleId }: StepProps) {
  const b = scan.balance;
  return (
    <>
      <div className={`${styles.tag} ${styles.tagBlue}`}>
        <CheckIcon size={16} />
        Already marked today · <span className="mono">{scan.code}</span>
        <CloseButton onClick={state.closeScan} />
      </div>
      <Person scan={scan} titleId={titleId} size={60} />
      <div className={styles.balance} aria-live="polite">
        <div>
          {b ? `${b.month_label} net` : "This month net"}
          <div className={styles.balanceNum}>{b ? formatRs(b.net) : "…"}</div>
        </div>
        <div>
          Paid
          <div className={`${styles.balanceNum} ${styles.balancePaid}`}>{b ? formatRs(b.paid) : "…"}</div>
        </div>
        <div>
          Due
          <div className={`${styles.balanceNum} ${styles.balanceDue}`}>{b ? formatAmount(b.due) : "…"}</div>
        </div>
      </div>
      <span className={styles.question}>What do you want to record?</span>
      <div className={styles.twoBig}>
        <button
          type="button"
          className={`${styles.big} ${styles.bigPresent} ${styles.bigPay}`}
          onClick={() => state.scanChoosePayment("salary")}
          disabled={!b}
        >
          <span className={styles.bigLabel}>Salary payment</span>
          <span className={styles.bigNp} lang="ne">
            तलब भुक्तानी
          </span>
        </button>
        <button
          type="button"
          className={`${styles.big} ${styles.bigOt} ${styles.bigPay}`}
          onClick={() => state.scanChoosePayment("advance")}
          disabled={!b}
        >
          <span className={styles.bigLabel}>Advance payment</span>
          <span className={styles.bigNp} lang="ne">
            पेश्की भुक्तानी
          </span>
        </button>
      </div>
      <button type="button" className={styles.changeLink} onClick={state.scanChangeAttendance}>
        Change today&apos;s attendance instead
      </button>
    </>
  );
}

function Pay({ scan, state, titleId }: StepProps) {
  const b = scan.balance!;
  const salary = scan.ptype === "salary";
  const typeLabel = salary ? "Salary payment" : "Advance payment";
  const amount = scanAmount(scan);
  const showError = scan.quick !== null && (scan.quick !== "custom" || scan.amount !== "");
  const error = showError ? paymentError(amount, b.due, b.month_label) : "Pick an amount.";
  const ok = error === null;
  const quick: [string, string][] = salary
    ? [
        ["full", `Full due · ${formatRs(b.due)}`],
        ["custom", "Custom amount"],
      ]
    : ADVANCE_QUICK;
  return (
    <>
      <div className={styles.payHead}>
        <button type="button" className={styles.backBtn} onClick={state.scanPayBack}>
          ‹ Back
        </button>
        <span className={`${styles.payPill} ${salary ? styles.payPillSalary : styles.payPillAdvance}`}>
          {typeLabel}
        </span>
        <CloseButton onClick={state.closeScan} />
      </div>
      <div className={styles.personText}>
        <h2 id={titleId} className={styles.personName}>
          {scan.employee!.name}
        </h2>
        <span className={styles.personMeta}>
          {typeLabel} for {b.month_label} · due {formatRs(b.due)}
        </span>
      </div>
      {salary ? (
        <div className={styles.breakdown}>
          <div>
            <span>{b.month_label.split(" ")[0]} net salary</span>
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
        {quick.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={scan.quick === key}
            className={`${styles.amountChip} ${salary ? styles.amountChipWide : ""} ${salary ? styles.amountChipTeal : styles.amountChipBlue}`}
            onClick={() => state.scanQuick(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {scan.quick === "custom" ? (
        <div className={`${styles.amountBox} ${scan.amount && !ok ? styles.amountBoxBad : ""}`}>
          <span className={styles.amountRs}>Rs</span>
          <input
            inputMode="numeric"
            aria-label="Custom amount"
            placeholder="Type amount"
            value={scan.amount}
            onChange={(e) => state.scanAmountText(e.target.value)}
            data-autofocus=""
          />
        </div>
      ) : null}
      {(showError && error) || scan.error ? (
        <span className={styles.error} role="alert">
          {scan.error ?? error}
        </span>
      ) : null}
      <div className={styles.methodGrid}>
        <button
          type="button"
          className={styles.methodBtn}
          aria-pressed={scan.method === "cash"}
          onClick={() => state.scanMethod("cash")}
        >
          Cash
        </button>
        <button
          type="button"
          className={styles.methodBtn}
          aria-pressed={scan.method === "bank"}
          onClick={() => state.scanMethod("bank")}
        >
          Bank transfer
        </button>
      </div>
      <button
        type="button"
        className={`${styles.paySave} ${salary ? styles.paySaveTeal : styles.paySaveBlue}`}
        disabled={!ok || scan.busy}
        onClick={state.scanSavePayment}
      >
        {scan.busy
          ? "Saving…"
          : `Save ${salary ? "salary" : "advance"}${ok ? ` · ${formatRs(amount)}` : ""}`}
      </button>
    </>
  );
}

function Paid({ scan, state, titleId }: StepProps) {
  const paid = scan.paid!;
  const typeLabel = scan.ptype === "salary" ? "Salary" : "Advance";
  const method = scan.method === "bank" ? "Bank transfer" : "Cash";
  return (
    <>
      <div className={styles.result}>
        <span className={styles.resultIcon}>
          <CheckIcon size={30} />
        </span>
        <h2 id={titleId} className={styles.personName}>
          {scan.employee!.name}
        </h2>
        <span className={styles.resultText}>
          {typeLabel} of {formatRs(paid.amount)} recorded
        </span>
        <span className={styles.resultSub}>
          {method} · {scan.balance?.month_label ?? ""} · due now {formatRs(paid.due_after)} · shows in Payments
        </span>
      </div>
      <div className={styles.twoBtns}>
        <button type="button" className={styles.secondary} onClick={state.closeScan}>
          Done
        </button>
        <button type="button" className={styles.primary} onClick={state.scanAgain}>
          Scan next
        </button>
      </div>
    </>
  );
}

function Missing({ scan, state, titleId }: StepProps) {
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
        <button type="button" className={styles.secondary} onClick={state.closeScan}>
          Close
        </button>
        <button type="button" className={styles.primary} onClick={state.scanAgain}>
          Scan again
        </button>
      </div>
    </>
  );
}

function Done({ scan, state, titleId }: StepProps) {
  const ot = scan.doneStatus === "O";
  return (
    <>
      <div className={styles.result}>
        <span className={styles.resultIcon}>
          <CheckIcon size={30} />
        </span>
        <h2 id={titleId} className={styles.personName}>
          {scan.employee!.name}
        </h2>
        <span className={styles.resultText}>
          {ot ? `Present + ${scan.doneHours} h overtime` : "Marked present"}
        </span>
        <span className={styles.resultNp} lang="ne">
          {ot ? `हाजिर + ओभरटाइम ${toDevanagariDigits(scan.doneHours)} घण्टा` : "हाजिर भयो"}
        </span>
      </div>
      <div className={styles.twoBtns}>
        <button type="button" className={styles.secondary} onClick={state.closeScan}>
          Done
        </button>
        <button type="button" className={styles.primary} onClick={state.scanAgain}>
          Scan next
        </button>
      </div>
    </>
  );
}
