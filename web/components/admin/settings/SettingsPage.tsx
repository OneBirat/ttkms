"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { errorMessage } from "@/lib/api";
import { getSettings, removeLogo, updateSettings, uploadLogo } from "../api";
import {
  changedGroups,
  groupHasErrors,
  settingsEqual,
  validateSettings,
  type SettingsErrors,
} from "../settingsValidation";
import {
  WEEKDAYS,
  type PaidBy,
  type Rounding,
  type SaturdayWorkRule,
  type Settings,
  type SettingsGroup,
  type SettingsInput,
  type SettingsMeta,
  type Weekday,
} from "../types";
import { BSDateTimeText } from "@/components/date";
import { AdminGate } from "../components/AdminGate";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Field, inputClass, Select } from "../components/Field";
import { Toast, useToast } from "../components/Toast";
import { Toggle } from "../components/Toggle";
import { useLoader } from "../components/useLoader";
import styles from "../components/admin.module.css";

/** payroll.saturday_work_rule - pending business decision (app/contracts.py). */
const SATURDAY_RULES: { value: SaturdayWorkRule; title: string; text: string }[] = [
  { value: "overtime_only", title: "Overtime hours only", text: "Pay only the hours worked on the Saturday" },
  { value: "extra_day", title: "Extra day", text: "Also pay salary ÷ 30 for the Saturday" },
];

const TITLE = "Settings";
const SUBTITLE = "Company details and the defaults the other modules start from.";

const GROUP_LABELS: Record<SettingsGroup, string> = {
  company: "Company",
  attendance: "Attendance",
  payroll: "Payroll",
  display: "Display",
};

export function SettingsPage() {
  return (
    <AdminGate page="settings" title={TITLE} subtitle={SUBTITLE}>
      {() => <SettingsScreen />}
    </AdminGate>
  );
}

function inputOf(settings: Settings): SettingsInput {
  return {
    company: {
      name: settings.company.name,
      address: settings.company.address,
      phone: settings.company.phone,
      pan_vat: settings.company.pan_vat,
    },
    attendance: { ...settings.attendance, weekly_off: [...settings.attendance.weekly_off] },
    payroll: { ...settings.payroll },
    display: { ...settings.display },
  };
}

function SettingsScreen() {
  const loader = useLoader(getSettings);
  const { toast, show, dismiss } = useToast();
  const [saved, setSaved] = useState<Settings | null>(null);
  const [form, setForm] = useState<SettingsInput | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmRemoveLogo, setConfirmRemoveLogo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (loader.data && !saved) {
      setSaved(loader.data);
      setForm(inputOf(loader.data));
    }
  }, [loader.data, saved]);

  const errors: SettingsErrors = useMemo(() => (form ? validateSettings(form) : {}), [form]);
  const dirty = Boolean(saved && form && !settingsEqual(inputOf(saved), form));
  const dirtyGroups = saved && form ? changedGroups(inputOf(saved), form) : [];
  const errorCount = Object.keys(errors).length;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (loader.error) {
    return (
      <>
        <PageHeader title={TITLE} subtitle={SUBTITLE} />
        <EmptyState icon="alert" title="Could not load settings" text={errorMessage(loader.error)}>
          <button type="button" className="btn" onClick={loader.reload}>
            Try again
          </button>
        </EmptyState>
      </>
    );
  }

  if (!form || !saved) {
    return (
      <>
        <PageHeader title={TITLE} subtitle={SUBTITLE} />
        <p className="muted" role="status">
          Loading…
        </p>
      </>
    );
  }

  const patch = <G extends SettingsGroup>(group: G, values: Partial<SettingsInput[G]>) => {
    setTouched(true);
    setForm((current) =>
      current ? { ...current, [group]: { ...current[group], ...values } } : current,
    );
  };

  const fieldError = (key: string) => (touched ? errors[key] ?? null : null);

  const save = async () => {
    setTouched(true);
    if (errorCount > 0 || !form) return;
    setSaving(true);
    try {
      const next = await updateSettings(form);
      setSaved(next);
      setForm(inputOf(next));
      setTouched(false);
      show("Settings saved.");
    } catch (err) {
      show(errorMessage(err), "danger");
    }
    setSaving(false);
  };

  const discard = () => {
    setForm(inputOf(saved));
    setTouched(false);
  };

  const onLogoPicked = async (file: File | null) => {
    if (!file) return;
    try {
      const next = await uploadLogo(file);
      setSaved((current) => (current ? { ...current, company: next.company, meta: next.meta } : next));
      show("Logo updated.");
    } catch (err) {
      show(errorMessage(err), "danger");
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const doRemoveLogo = async () => {
    const next = await removeLogo();
    setSaved((current) => (current ? { ...current, company: next.company, meta: next.meta } : next));
    setConfirmRemoveLogo(false);
    show("Logo removed.");
  };

  const toggleDay = (day: Weekday, on: boolean) => {
    const current = form.attendance.weekly_off;
    const next = on ? [...new Set([...current, day])] : current.filter((d) => d !== day);
    patch("attendance", { weekly_off: next });
  };

  return (
    <div className={styles.stack}>
      <PageHeader title={TITLE} subtitle={SUBTITLE} />

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        noValidate
      >
        <div className={styles.settingsGrid}>
          <SettingsCard
            group="company"
            meta={saved.meta.company}
            dirty={dirtyGroups.includes("company")}
            invalid={touched && groupHasErrors(errors, "company")}
          >
            <Field label="Company name" error={fieldError("company.name")}>
              {({ id, describedBy, invalid }) => (
                <input
                  id={id}
                  className={inputClass(invalid)}
                  value={form.company.name}
                  onChange={(e) => patch("company", { name: e.target.value })}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  maxLength={120}
                  required
                />
              )}
            </Field>
            <Field label="Address" error={fieldError("company.address")}>
              {({ id, describedBy, invalid }) => (
                <input
                  id={id}
                  className={inputClass(invalid)}
                  value={form.company.address}
                  onChange={(e) => patch("company", { address: e.target.value })}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  maxLength={240}
                  placeholder="Street, city"
                />
              )}
            </Field>
            <div className={styles.grid2}>
              <Field label="Phone" error={fieldError("company.phone")}>
                {({ id, describedBy, invalid }) => (
                  <input
                    id={id}
                    className={inputClass(invalid, "mono")}
                    inputMode="tel"
                    value={form.company.phone}
                    onChange={(e) => patch("company", { phone: e.target.value })}
                    aria-describedby={describedBy}
                    aria-invalid={invalid || undefined}
                    placeholder="01-4XXXXXX"
                  />
                )}
              </Field>
              <Field
                label="PAN / VAT number"
                hint="Optional. Printed on PDF headers when set."
                error={fieldError("company.pan_vat")}
              >
                {({ id, describedBy, invalid }) => (
                  <input
                    id={id}
                    className={inputClass(invalid, "mono")}
                    inputMode="numeric"
                    value={form.company.pan_vat}
                    onChange={(e) => patch("company", { pan_vat: e.target.value })}
                    aria-describedby={describedBy}
                    aria-invalid={invalid || undefined}
                    placeholder="9 digits"
                    maxLength={9}
                  />
                )}
              </Field>
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel} id="logo-label">
                Logo
              </span>
              <div className={styles.logoRow} role="group" aria-labelledby="logo-label">
                <span className={styles.logoBox}>
                  {saved.company.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- data URL preview
                    <img src={saved.company.logo_url} alt="Company logo" />
                  ) : (
                    "No logo"
                  )}
                </span>
                <div className={styles.inputRow}>
                  <input
                    ref={fileRef}
                    id="logo-file"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="sr-only"
                    onChange={(e) => void onLogoPicked(e.target.files?.[0] ?? null)}
                  />
                  <label htmlFor="logo-file" className="btn">
                    {saved.company.logo_url ? "Replace logo" : "Upload logo"}
                  </label>
                  {saved.company.logo_url ? (
                    <button
                      type="button"
                      className={`btn ${styles.ghostDanger}`}
                      onClick={() => setConfirmRemoveLogo(true)}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                <span className={styles.fieldHint} style={{ flexBasis: "100%" }}>
                  PNG, JPG, WebP or SVG up to 512 KB. Used on PDF headers. Saved immediately.
                </span>
              </div>
            </div>
          </SettingsCard>

          <SettingsCard
            group="attendance"
            meta={saved.meta.attendance}
            dirty={dirtyGroups.includes("attendance")}
            invalid={touched && groupHasErrors(errors, "attendance")}
          >
            <Field
              label="Late after"
              hint="Arrivals after this time are marked late."
              error={fieldError("attendance.late_after")}
            >
              {({ id, describedBy, invalid }) => (
                <input
                  id={id}
                  type="time"
                  className={inputClass(invalid, styles.timeInput)}
                  value={form.attendance.late_after}
                  onChange={(e) => patch("attendance", { late_after: e.target.value })}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  step={60}
                  required
                />
              )}
            </Field>
            <fieldset className={styles.fieldset}>
              <legend className={styles.fieldLabel} style={{ marginBottom: 4 }}>
                Weekly off days
              </legend>
              <div className={styles.checkList}>
                {WEEKDAYS.map((day) => (
                  <label key={day.value} className={styles.check}>
                    <input
                      type="checkbox"
                      checked={form.attendance.weekly_off.includes(day.value)}
                      onChange={(e) => toggleDay(day.value, e.target.checked)}
                    />
                    <span lang="ne" aria-hidden="true">
                      {day.np}
                    </span>
                    {day.label}
                  </label>
                ))}
              </div>
              {fieldError("attendance.weekly_off") ? (
                <p className={styles.fieldError} role="alert">
                  {fieldError("attendance.weekly_off")}
                </p>
              ) : null}
            </fieldset>
            <Field
              label="Half-day rule"
              hint="Shown to whoever marks attendance; the attendance module applies it."
              error={fieldError("attendance.half_day_note")}
            >
              {({ id, describedBy, invalid }) => (
                <textarea
                  id={id}
                  className={inputClass(invalid)}
                  rows={2}
                  style={{ padding: "10px 12px", resize: "vertical" }}
                  value={form.attendance.half_day_note}
                  onChange={(e) => patch("attendance", { half_day_note: e.target.value })}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  maxLength={240}
                />
              )}
            </Field>
          </SettingsCard>

          <SettingsCard
            group="payroll"
            meta={saved.meta.payroll}
            dirty={dirtyGroups.includes("payroll")}
            invalid={touched && groupHasErrors(errors, "payroll")}
          >
            <Field
              label="Pay day (BS day of month)"
              hint="Salaries for a month are due on this day of the next BS month."
              error={fieldError("payroll.pay_day")}
            >
              {({ id, describedBy, invalid }) => (
                <input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={32}
                  className={inputClass(invalid, styles.numInput)}
                  value={Number.isNaN(form.payroll.pay_day) ? "" : form.payroll.pay_day}
                  onChange={(e) => patch("payroll", { pay_day: e.target.valueAsNumber })}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  required
                />
              )}
            </Field>
            <div className={styles.field}>
              <span className={styles.fieldLabel} id="paidby-label">
                Default paid by
              </span>
              <div className={styles.radioCards} role="group" aria-labelledby="paidby-label">
                {(["cash", "bank"] as PaidBy[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={styles.radioCard}
                    aria-pressed={form.payroll.default_paid_by === value}
                    onClick={() => patch("payroll", { default_paid_by: value })}
                  >
                    <strong>{value === "cash" ? "Cash" : "Bank"}</strong>
                    <span>
                      {value === "cash" ? "Paid out at the counter" : "Transferred to the account"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <Field label="Rounding" error={fieldError("payroll.rounding")}>
              {({ id, describedBy, invalid }) => (
                <Select
                  id={id}
                  invalid={invalid}
                  value={form.payroll.rounding}
                  aria-describedby={describedBy}
                  onChange={(e) => patch("payroll", { rounding: e.target.value as Rounding })}
                >
                  <option value="nearest_rupee">Nearest rupee</option>
                  <option value="none">No rounding (paisa kept)</option>
                </Select>
              )}
            </Field>
            <div className={styles.field}>
              <span className={styles.fieldLabel} id="saturday-label">
                Saturday work (monthly staff)
              </span>
              <div className={styles.radioCards} role="group" aria-labelledby="saturday-label">
                {SATURDAY_RULES.map(({ value, title, text }) => (
                  <button
                    key={value}
                    type="button"
                    className={styles.radioCard}
                    aria-pressed={form.payroll.saturday_work_rule === value}
                    onClick={() => patch("payroll", { saturday_work_rule: value })}
                  >
                    <strong>{title}</strong>
                    <span>{text}</span>
                  </button>
                ))}
              </div>
              <span className={styles.fieldHint}>
                Pending decision. Daily-wage staff always get the day&apos;s wage plus the hours.
              </span>
            </div>
          </SettingsCard>

          <SettingsCard
            group="display"
            meta={saved.meta.display}
            dirty={dirtyGroups.includes("display")}
            invalid={false}
          >
            <Toggle
              label="Show AD dates alongside BS"
              hint="BS stays first; the AD date appears as secondary text."
              checked={form.display.show_ad_dates}
              onChange={(show_ad_dates) => patch("display", { show_ad_dates })}
            />
            <Toggle
              label="Nepali digits in dates"
              hint="२०८३-०७-०६ instead of 2083-07-06 on screens and PDFs."
              checked={form.display.nepali_digits}
              onChange={(nepali_digits) => patch("display", { nepali_digits })}
            />
          </SettingsCard>
        </div>

        {dirty ? (
          <div className={styles.saveBar} role="region" aria-label="Unsaved changes">
            <span className={styles.saveBarText}>
              {errorCount > 0 && touched
                ? `Fix ${errorCount} field${errorCount === 1 ? "" : "s"} before saving.`
                : `Unsaved changes in ${dirtyGroups.map((g) => GROUP_LABELS[g]).join(", ")}.`}
            </span>
            <button type="button" className="btn" onClick={discard} disabled={saving}>
              Discard
            </button>
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        ) : null}
      </form>

      <ConfirmDialog
        open={confirmRemoveLogo}
        title="Remove logo?"
        confirmLabel="Remove"
        danger
        onConfirm={doRemoveLogo}
        onClose={() => setConfirmRemoveLogo(false)}
      >
        <p>PDF headers will show the company name only until a new logo is uploaded.</p>
      </ConfirmDialog>

      <Toast toast={toast} onDismiss={dismiss} />
    </div>
  );
}

function SettingsCard({
  group,
  meta,
  dirty,
  invalid,
  children,
}: {
  group: SettingsGroup;
  meta: SettingsMeta;
  dirty: boolean;
  invalid: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`card ${styles.cardPad}`}
      aria-labelledby={`settings-${group}`}
      style={invalid ? { borderColor: "var(--pill-danger-fg)" } : undefined}
    >
      <div className={styles.cardHead}>
        <h2 id={`settings-${group}`} className={styles.cardTitle}>
          {GROUP_LABELS[group]}
        </h2>
        {dirty ? <span className={`${styles.secondary}`}>Edited</span> : null}
      </div>
      <div className={styles.form}>{children}</div>
      <p className={styles.lastChanged}>
        {meta.updated_by && meta.updated_at && meta.updated_at_bs ? (
          <>
            Last changed by {meta.updated_by} on <BSDateTimeText value={meta.updated_at} inline />
          </>
        ) : (
          "Not changed yet - using defaults."
        )}
      </p>
    </section>
  );
}
