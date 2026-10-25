"use client";

import { useEffect, useId, useRef, useState } from "react";
import { PaidByPicker } from "@/app/people/_components/PaidByPicker";
import { NO_SALARY, NoSalaryNotice } from "@/app/people/_components/NoSalaryNotice";
import { useSession } from "@/lib/session";
import { WEEKDAYS_NE, diffDays, formatAdShort, monthLabel, monthName, parseMonthKey, toNepaliDigits } from "@/lib/bs";
import { bsMonthDays } from "../calendar";
import { CheckIcon } from "../icons";
import { draftText, formatAmount, formatRs, initials } from "../helpers";
import { photoTint } from "../MarkRow";
import type { DayCell, DayHeader, PaymentRecord, PaymentType } from "../types";
import { useDialog } from "../useDialog";
import type { MarkState } from "../useMarkState";
import { useSecondsLeft } from "./useCountdown";
import { AUTO_RETURN, amountError, amountOf, type Scan } from "./scanFlow";
import { allocate } from "@/app/people/_lib/settle";
import styles from "./scan.module.css";

/** Quick overtime picks; anything longer goes through "Custom hours (4–12 h)". */
const OT_QUICK = [1, 2, 3];
const ADVANCE_QUICK: [string, string][] = [
  ["500", "Rs 500"],
  ["1000", "Rs 1,000"],
  ["1500", "Rs 1,500"],
  ["2000", "Rs 2,000"],
  ["custom", "Custom"],
];
const WEEKDAYS_NP = ["आइत", "सोम", "मंगल", "बुध", "बिही", "शुक्र", "शनि"];

type Step<S extends Scan["step"]> = Extract<Scan, { step: S }>;

/**
 * The sheets of the scan loop (design/final/AttendanceScan*.dc.html): card read →
 * Present / Overtime (1–3 h or custom 4–12); already marked → Payment record /
 * Attendance record / Salary / Advance → amount → history; no employee found;
 * saved (7 s) and paid (8 s) with "Next scan in Ns"; one person's attendance
 * record with a day detail pop-up. Desktop: dialog near the top; phone: bottom
 * sheet over the camera (or over the list when opened from the ⋮ menu).
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
        {scan.step === "attrec" ? <AttendanceRecord scan={scan} state={state} titleId={titleId} /> : null}
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

/** Bank-note: salary. */
function SalaryIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="9" width="16" height="10" rx="1.5" />
      <circle cx="10" cy="14" r="2" />
      <path d="M5 6.5h15.5a1 1 0 0 1 1 1V15" />
      <path d="M8 4h14" />
    </svg>
  );
}

/** Wallet card: advance. */
function AdvanceIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="6.5" width="19" height="11" rx="1.5" />
      <circle cx="12" cy="12" r="2.4" />
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
  // "Custom hours" stays open once picked, even if the stepper goes back under 4.
  const [customPicked, setCustomPicked] = useState(false);
  const custom = ot && (customPicked || scan.hours > 3);
  useEffect(() => {
    if (!ot) setCustomPicked(false);
  }, [ot]);
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
            className={`${styles.big} ${styles.bigTall} ${styles.bigPresent}`}
            onClick={flow.present}
            disabled={scan.busy}
            data-autofocus=""
          >
            <span className={styles.bigGlyph} aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
            <span className={styles.bigLabel}>Present</span>
            <span className={styles.bigNp} lang="ne">
              हाजिर
            </span>
            <span className={styles.bigSub}>Tap to save</span>
          </button>
          <button
            type="button"
            className={`${styles.big} ${styles.bigTall} ${styles.bigOt}`}
            onClick={() => flow.otMode(true)}
            disabled={scan.busy}
          >
            <span className={styles.bigGlyph} aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="13" r="7" />
                <path d="M11 9.5V13l2.2 1.6M18.5 3v5M16 5.5h5" />
              </svg>
            </span>
            <span className={styles.bigLabel}>Overtime</span>
            <span className={styles.bigNp} lang="ne">
              ओभरटाइम
            </span>
            <span className={styles.bigSub}>Pick hours</span>
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
                aria-checked={!custom && scan.hours === h}
                className={styles.hourChip}
                onClick={() => {
                  setCustomPicked(false);
                  flow.setHours(h);
                }}
                data-autofocus={!custom && scan.hours === h ? "" : undefined}
              >
                {h} h
              </button>
            ))}
          </div>
          {!custom ? (
            <button
              type="button"
              className={styles.hcBtn}
              onClick={() => {
                setCustomPicked(true);
                flow.setHours(Math.max(4, scan.hours));
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Custom hours (4–12 h)
            </button>
          ) : (
            <div role="group" aria-label="Custom overtime hours" className={styles.stepper}>
              <button type="button" aria-label="One hour less" className={styles.stepBtn} onClick={() => flow.setHours(scan.hours - 1)}>
                −
              </button>
              <span aria-live="polite" className={styles.stepValue}>
                {scan.hours} h
              </span>
              <button type="button" aria-label="One hour more" className={styles.stepBtn} onClick={() => flow.setHours(scan.hours + 1)}>
                +
              </button>
            </div>
          )}
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
      <div className={styles.recBtns}>
        {state.canPay ? (
          <button type="button" className={styles.recBtn} onClick={flow.openPaymentRecord}>
            <SalaryIcon size={18} />
            Payment record
          </button>
        ) : null}
        <button type="button" className={styles.recBtn} onClick={flow.openAttendanceRecord}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="17" rx="2" />
            <path d="M3 9h18M8 2v4M16 2v4" />
          </svg>
          Attendance record
        </button>
      </div>
      {state.canPay ? (
        <>
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
        </>
      ) : null}
      <button type="button" className={styles.changeLink} onClick={flow.changeAttendance}>
        Change today&apos;s attendance instead
      </button>
      <SkipButton onClick={flow.skip} />
    </>
  );
}

function paymentsCount(history: PaymentRecord[] | null): string {
  if (!history) return "…";
  const n = history.length;
  return n === 0 ? "no payments" : `${n} ${n === 1 ? "payment" : "payments"}`;
}

function typeNp(type: PaymentType): string {
  return type === "salary" ? "तलब भुक्तानी" : "पेश्की भुक्तानी";
}

function Pay({ scan, state, titleId }: StepProps<"pay">) {
  const flow = state.flow;
  const { user } = useSession();
  const b = scan.balance;
  const salary = scan.type === "salary";
  const typeLabel = salary ? "Salary payment" : "Advance payment";
  const amount = amountOf(scan);
  const validation = amountError(scan);
  const showError = scan.pick !== null && (scan.pick !== "custom" || scan.amount !== "") && validation !== null;
  // Salary: one amount over the salary due, oldest month first (scan.dues from payroll).
  const settles = salary && scan.dues !== undefined;
  const dues = scan.dues ?? null;
  const ok = validation === null && (settles ? !!dues : !!b);
  const quick: [string, string][] = settles
    ? [
        ...(dues && dues.past_due > 0 && dues.past_due !== dues.total_due
          ? ([["past", `All past months · ${formatRs(dues.past_due)}`]] as [string, string][])
          : []),
        ["full", dues ? `Everything incl. ${monthName(dues.running_month.bs_month)} · ${formatRs(dues.total_due)}` : "Everything due · …"],
        ["custom", "Custom amount"],
      ]
    : salary
      ? [
          ["full", `Full due · ${b ? formatRs(b.due) : "…"}`],
          ["custom", "Custom amount"],
        ]
      : ADVANCE_QUICK;
  const covers = settles && dues && ok ? allocate(amount, dues.months) : [];
  const month = b?.month_label ?? "this month";
  return (
    <>
      <div className={styles.payHead}>
        <button type="button" className={styles.backBtn} onClick={flow.payBack}>
          ‹ Back
        </button>
        <CloseButton onClick={flow.skip} />
      </div>
      <div className={`${styles.payBand} ${salary ? styles.payBandSalary : styles.payBandAdvance}`}>
        <span className={styles.payBandIcon} aria-hidden="true">
          {salary ? <SalaryIcon size={24} /> : <AdvanceIcon size={24} />}
        </span>
        <span className={styles.payBandText}>
          <span className={styles.payBandType}>{typeLabel}</span>
          <span className={styles.payBandNp} lang="ne">
            {typeNp(scan.type)}
          </span>
        </span>
        <span className={styles.payBandMonth}>{settles ? "Oldest month first" : salary && b ? `Salary for ${month}` : month}</span>
      </div>
      <div className={styles.personText}>
        <h2 id={titleId} className={styles.personName}>
          {scan.emp.name}
        </h2>
        <span className={styles.personMeta}>
          {scan.emp.code} · {scan.emp.department_name} · {scan.emp.branch_name}
        </span>
      </div>
      {settles ? (
        <div className={styles.breakdown} aria-label="Salary due · oldest first">
          {!dues ? (
            <div>
              <span>Loading the salary due…</span>
            </div>
          ) : (
            dues.months
              .filter((m) => m.due > 0)
              .map((m) => (
                <div key={m.label}>
                  <span>
                    {m.label}
                    {m.in_progress ? " · so far" : ""}
                  </span>
                  <span className="mono">{formatRs(m.due)}</span>
                </div>
              ))
          )}
          <div className={styles.breakdownDue}>
            <span>Total due</span>
            <span className="mono">{dues ? formatRs(dues.total_due) : "…"}</span>
          </div>
        </div>
      ) : salary && b ? (
        <div className={styles.breakdown}>
          <div>
            <span>{month.split(" ")[0]} net salary</span>
            <span className="mono">{formatRs(b.earned)}</span>
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
      {covers.length > 0 ? (
        <div className={styles.breakdown} aria-label="This payment covers">
          {covers.map((a) => (
            <div key={a.month.label} className={a.full ? styles.breakdownPaid : undefined}>
              <span>
                {a.month.label} · {a.full ? "cleared" : `${formatRs(a.due - a.amount)} left`}
              </span>
              <span className="mono">{formatRs(a.amount)}</span>
            </div>
          ))}
          <div>
            <span>Applied to the oldest month first · one receipt</span>
          </div>
        </div>
      ) : null}
      <PaidByPicker
        modes={state.paymentModes}
        value={scan.mode}
        onChange={flow.setMode}
        type={scan.type}
        variant="other"
        manageHref={user?.role === "admin" ? "/admin/payment-modes" : null}
        reference=""
        onReference={() => {}}
        noReference
      />
      {scan.error && scan.errorCode === NO_SALARY ? (
        <NoSalaryNotice employeeId={scan.emp.id} className={styles.error} message={scan.error} />
      ) : showError || scan.error ? (
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

function dayNote(p: PaymentRecord, todayBs: string | undefined): string {
  if (p.date_bs === todayBs) {
    const age = Date.now() - Date.parse(p.recorded_at);
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
  const backLabel = scan.from === "pay" ? "Back to payment" : scan.from === "already" ? "Back" : "Close";
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
          <span className={styles.tileAmount}>{b ? formatRs(b.earned) : "…"}</span>
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
            <li key={p.payment_id} className={styles.histRow}>
              <span className={styles.histDate} aria-hidden="true">
                <span className={styles.histMon}>{monthName(Number(p.date_bs.slice(5, 7)))}</span>
                <span className={styles.histDay}>{Number(p.date_bs.slice(8, 10))}</span>
              </span>
              <span className={styles.histText}>
                <span className={styles.histType} data-type={p.kind}>
                  {p.kind === "advance" ? "Advance" : "Salary"}
                </span>
                <span className={styles.histNote}>{dayNote(p, todayBs)}</span>
              </span>
              <span className={styles.histAmount}>Rs {formatAmount(p.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className={styles.histBackPrimary} onClick={flow.historyBack}>
        {backLabel}
      </button>
    </>
  );
}

// ------------------------------------------------------------ attendance record

type RecKind = "P" | "O" | "A" | "off" | "N" | "F";

interface RecDay {
  header: DayHeader;
  cell: DayCell | null;
  kind: RecKind;
  payments: PaymentRecord[];
}

function cellText(kind: RecKind, cell: DayCell | null): string {
  switch (kind) {
    case "P":
      return "✓";
    case "O":
      return `${cell?.ot_hours ?? 0}h`;
    case "A":
      return "A";
    case "off":
      return "Off";
    case "N":
      return "–";
    default:
      return "";
  }
}

function attendanceText(kind: RecKind, cell: DayCell | null): string {
  switch (kind) {
    case "P":
      return "✓ Present";
    case "O":
      return `Present + ${cell?.ot_hours ?? 0} h overtime`;
    case "A":
      return "Absent";
    case "off":
      return "Weekly off (Saturday)";
    case "N":
      return "Not marked yet";
    default:
      return "—";
  }
}

function AttendanceRecord({ scan, state, titleId }: StepProps<"attrec">) {
  const flow = state.flow;
  const parts = parseMonthKey(scan.monthKey);
  const year = parts?.year ?? 0;
  const month = parts?.month ?? 1;
  const todayAd = state.today?.ad_date;
  const todayKey = state.today ? state.today.bs_date.slice(0, 7) : scan.monthKey;
  const nextOff = scan.monthKey >= todayKey;
  const headers = parts ? bsMonthDays(year, month, 6) : [];
  const data = scan.month;
  const days: RecDay[] = headers.map((h, i) => {
    const cell = data?.cells[i] ?? null;
    const future = todayAd ? diffDays(todayAd, h.ad_date) > 0 : false;
    const kind: RecKind = future
      ? "F"
      : h.is_weekly_off && (!cell || cell.status === "W" || cell.status === "N")
        ? "off"
        : !cell || cell.status === "W"
          ? "off"
          : cell.status === "N"
            ? "N"
            : cell.status;
    const payments = (data?.payments ?? []).filter((p) => p.date_bs === h.bs_date);
    return { header: h, cell, kind, payments };
  });
  const lead = headers[0]?.weekday ?? 0;
  const totals = data?.totals;
  const dayPop = scan.dayPop !== null ? days.find((d) => d.header.bs_day === scan.dayPop) ?? null : null;
  const np = data?.month.label_np ?? monthLabel(year, month, "ne");
  const en = data?.month.label ?? monthLabel(year, month);
  return (
    <>
      <div className={styles.histHead}>
        <button type="button" className={styles.backLink} onClick={flow.recordBack} data-autofocus="">
          <BackChevron />
          Back
        </button>
        <span className={styles.monthPill}>Attendance record</span>
      </div>
      <div className={styles.personText}>
        <h2 id={titleId} className={styles.personName}>
          {scan.emp.name}
        </h2>
        <span className={styles.personMeta}>
          {scan.emp.code} · {scan.emp.department_name} · {scan.emp.branch_name}
        </span>
      </div>
      <div className={styles.recNav}>
        <button type="button" aria-label="Previous month" className={styles.recNavBtn} onClick={() => flow.recordMonth(-1)}>
          <BackChevron />
        </button>
        <div className={styles.recTitle}>
          <span lang="ne" className={styles.recNp}>
            {np}
          </span>
          <span className={styles.recEn}>{en}</span>
        </div>
        <button type="button" aria-label="Next month" className={styles.recNavBtn} disabled={nextOff} onClick={() => flow.recordMonth(1)}>
          <span className={styles.flip}>
            <BackChevron />
          </span>
        </button>
      </div>
      <div className={styles.recTiles} aria-busy={scan.busy}>
        <div className={`${styles.recTile} ${styles.recTileP}`}>
          <span>Present</span>
          <b>{totals ? `${totals.present + totals.overtime_days} ${totals.present + totals.overtime_days === 1 ? "day" : "days"}` : "…"}</b>
        </div>
        <div className={`${styles.recTile} ${styles.recTileO}`}>
          <span>Overtime</span>
          <b>{totals ? `${totals.overtime_days}d ${totals.overtime_hours}h` : "…"}</b>
        </div>
        <div className={`${styles.recTile} ${styles.recTileA}`}>
          <span>Absent</span>
          <b>{totals ? `${totals.absent} ${totals.absent === 1 ? "day" : "days"}` : "…"}</b>
        </div>
      </div>
      {scan.error ? (
        <p role="alert" className={styles.error}>
          {scan.error}
        </p>
      ) : null}
      <div className={styles.recWeekdays} lang="ne" aria-hidden="true">
        {WEEKDAYS_NP.map((w, i) => (
          <span key={w} className={i === 6 ? styles.recSat : undefined}>
            {w}
          </span>
        ))}
      </div>
      <div role="group" aria-label={en} className={styles.recGrid}>
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} aria-hidden="true" />
        ))}
        {days.map((d) => {
          const hasAdv = d.payments.some((p) => p.kind === "advance");
          const hasSal = d.payments.some((p) => p.kind === "salary");
          const label = `${monthName(month)} ${d.header.bs_day}: ${attendanceText(d.kind, d.cell)}${
            d.payments.length ? `, ${d.payments.length} ${d.payments.length === 1 ? "payment" : "payments"}` : ""
          }`;
          return (
            <button
              key={d.header.bs_date}
              type="button"
              aria-label={label}
              disabled={d.payments.length === 0}
              className={styles.recCell}
              data-k={d.kind}
              data-pop={scan.dayPop === d.header.bs_day || undefined}
              onClick={() => flow.recordDay(d.header.bs_day)}
            >
              {hasAdv ? (
                <span className={`${styles.recBadge} ${styles.recBadgeAdv}`} title="Advance taken">
                  <AdvanceIcon size={10} />
                </span>
              ) : null}
              {hasSal ? (
                <span className={`${styles.recBadge} ${styles.recBadgeSal}`} title="Salary taken">
                  <SalaryIcon size={10} />
                </span>
              ) : null}
              <span lang="ne" className={styles.recCellNp}>
                {toNepaliDigits(d.header.bs_day)}
              </span>
              <span className={styles.recCellText}>{cellText(d.kind, d.cell)}</span>
            </button>
          );
        })}
      </div>
      <div className={styles.recLegend}>
        <span>
          <b className={styles.recLegP}>✓</b> Present
        </span>
        <span>
          <b className={styles.recLegO}>2h</b> OT
        </span>
        <span>
          <b className={styles.recLegA}>A</b> Absent
        </span>
        <span>
          <b className={styles.recLegOff}>Off</b> <span lang="ne">शनि</span>
        </span>
        <span>
          <span className={`${styles.recBadge} ${styles.recBadgeAdv} ${styles.recBadgeLeg}`}>
            <AdvanceIcon size={10} />
          </span>{" "}
          Advance
        </span>
        <span>
          <span className={`${styles.recBadge} ${styles.recBadgeSal} ${styles.recBadgeLeg}`}>
            <SalaryIcon size={10} />
          </span>{" "}
          Salary
        </span>
      </div>
      <button type="button" className={styles.histBackPrimary} onClick={flow.recordBack}>
        {scan.from === "list" ? "Close" : "Back"}
      </button>
      {dayPop ? <DayDetail day={dayPop} scan={scan} monthIndex={month} year={year} onClose={() => flow.recordDay(null)} /> : null}
    </>
  );
}

function DayDetail({
  day,
  scan,
  monthIndex,
  year,
  onClose,
}: {
  day: RecDay;
  scan: Step<"attrec">;
  monthIndex: number;
  year: number;
  onClose: () => void;
}) {
  const titleId = useId();
  const h = day.header;
  const total = day.payments.reduce((a, p) => a + p.amount, 0);
  return (
    <div className={styles.dpBackdrop} onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={styles.dpDialog}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.dpHead}>
          <span role="img" aria-label={`Photo of ${scan.emp.name}`} className={styles.dpPhoto} style={{ background: photoTint(scan.emp.id) }}>
            {initials(scan.emp.name)}
          </span>
          <div className={styles.personText}>
            <h3 id={titleId} className={styles.dpName}>
              {scan.emp.name}
            </h3>
            <span lang="ne" className={styles.dpNp}>
              {WEEKDAYS_NE[h.weekday]}, {monthLabel(year, monthIndex, "ne").split(" ")[0]} {toNepaliDigits(h.bs_day)}
            </span>
            <span className={styles.personMeta}>
              {monthName(monthIndex)} {h.bs_day}, {year} · {formatAdShort(h.ad_date, true)}
            </span>
          </div>
          <CloseButton onClick={onClose} />
        </div>
        <div className={styles.dpAtt} data-k={day.kind}>
          <span>Attendance</span>
          <b>{attendanceText(day.kind, day.cell)}</b>
        </div>
        <span className={styles.fieldLabel}>Money taken this day</span>
        <div className={styles.dpList}>
          {day.payments.map((p) => {
            const sal = p.kind === "salary";
            return (
              <div key={p.payment_id} className={`${styles.dpRow} ${sal ? styles.dpRowSal : styles.dpRowAdv}`}>
                <span className={`${styles.dpIcon} ${sal ? styles.dpIconSal : styles.dpIconAdv}`} aria-hidden="true">
                  {sal ? <SalaryIcon /> : <AdvanceIcon />}
                </span>
                <span className={styles.dpText}>
                  <span className={styles.dpType}>
                    {sal ? "Salary" : "Advance"}{" "}
                    <span lang="ne" className={styles.dpTypeNp}>
                      · {sal ? "तलब" : "पेश्की"}
                    </span>
                  </span>
                  <span className={styles.dpMeta}>{p.note}</span>
                </span>
                <span className={styles.dpAmount}>Rs {formatAmount(p.amount)}</span>
              </div>
            );
          })}
        </div>
        <div className={styles.dpTotal}>
          <span>Total this day</span>
          <b>Rs {formatAmount(total)}</b>
        </div>
        <button type="button" className={styles.histBackPrimary} onClick={onClose} data-autofocus="">
          Close
        </button>
      </section>
    </div>
  );
}

// ------------------------------------------------------------ results

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

function Countdown({ state, phone, token, totalMs }: { state: MarkState; phone: boolean; token: number; totalMs: number }) {
  const flow = state.flow;
  const left = useSecondsLeft(token, totalMs);
  return (
    <>
      <div className={styles.countdown}>
        <div className={styles.progress} aria-hidden="true">
          <div key={token} className={styles.progressBar} style={{ animationDuration: `${totalMs}ms` }} />
        </div>
        <span className={styles.countdownText} aria-live="off">
          Next scan in <b>{left}s</b>
          {!phone ? " — the next card can be scanned now" : ""}
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

function SavedMark() {
  return (
    <svg role="img" aria-label="Saved" width="22" height="22" viewBox="0 0 24 24" className={styles.savedMark}>
      <circle cx="12" cy="12" r="11" fill="#0E6B6B" />
      <path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Done({ scan, state, titleId, phone }: StepProps<"done"> & { phone: boolean }) {
  const ot = scan.status === "O";
  return (
    <>
      <div className={styles.result}>
        <span className={styles.donePhotoWrap}>
          <span role="img" aria-label={`Photo of ${scan.emp.name}`} className={styles.donePhoto} style={{ background: photoTint(scan.emp.id) }}>
            {initials(scan.emp.name)}
          </span>
          <span aria-hidden="true" className={styles.doneBadge} data-status={scan.status}>
            <CheckIcon size={16} />
          </span>
        </span>
        <h2 id={titleId} className={`${styles.personName} ${styles.nameRow}`}>
          {scan.emp.name}
          <SavedMark />
        </h2>
        <span className={styles.resultText}>{ot ? `Present + ${scan.hours} h overtime` : "Marked present"}</span>
        <span className={styles.resultNp} lang="ne">
          {ot ? `हाजिर + ओभरटाइम ${toNepaliDigits(scan.hours)} घण्टा` : "हाजिर भयो"}
        </span>
      </div>
      <Countdown state={state} phone={phone} token={scan.token} totalMs={AUTO_RETURN.done} />
    </>
  );
}

function Paid({ scan, state, titleId, phone }: StepProps<"paid"> & { phone: boolean }) {
  const salary = scan.type === "salary";
  const typeLabel = salary ? "Salary" : "Advance";
  const monthShort = scan.monthLabel.split(" ")[0];
  return (
    <>
      <div className={styles.result}>
        <span className={`${styles.resultIcon} ${salary ? styles.resultIconSal : styles.resultIconAdv}`}>
          {salary ? <SalaryIcon size={28} /> : <AdvanceIcon size={28} />}
        </span>
        <h2 id={titleId} className={styles.personName}>
          {scan.emp.name}
        </h2>
        <span className={styles.resultText}>
          {typeLabel} of {formatRs(scan.paid.payment.amount)} recorded
        </span>
        <span className={styles.resultNp} lang="ne">
          {salary ? "तलब भुक्तानी सेभ भयो" : "पेश्की भुक्तानी सेभ भयो"}
        </span>
        <span className={styles.resultSub}>{scan.paid.payment.payment_mode} · {scan.monthLabel} · shows in Payment reports</span>
      </div>
      <div className={styles.paidTiles}>
        <div className={`${styles.paidTile} ${salary ? styles.paidTileSal : styles.paidTileAdv}`}>
          <span>Paid now</span>
          <b>{formatRs(scan.paid.payment.amount)}</b>
        </div>
        {scan.split ? (
          <div className={styles.paidTile}>
            <span>Months</span>
            <b>{scan.split.length}</b>
          </div>
        ) : (
          <div className={styles.paidTile}>
            <span>Paid in {monthShort}</span>
            <b>{formatRs(scan.monthPaid)}</b>
          </div>
        )}
        <div className={`${styles.paidTile} ${styles.paidTileDue}`}>
          <span>Still due</span>
          <b>{formatRs(scan.paid.due_after)}</b>
        </div>
      </div>
      {scan.split ? (
        <div className={styles.breakdown} aria-label="Split by month">
          {scan.split.map((x) => (
            <div key={x.label} className={x.cleared ? styles.breakdownPaid : undefined}>
              <span>
                {x.label}
                {x.cleared ? " · cleared" : ""}
              </span>
              <span className="mono">{formatRs(x.amount)}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className={styles.receipt}>
        Receipt no. <span className="mono">{scan.paid.payment.receipt_no}</span>
      </div>
      <Countdown state={state} phone={phone} token={scan.token} totalMs={AUTO_RETURN.paid} />
    </>
  );
}
