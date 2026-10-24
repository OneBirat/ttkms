"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Segmented } from "@/components/ui/Segmented";
import { errorMessage } from "@/lib/api";
import { AdminGate } from "../components/AdminGate";
import { Switch } from "../components/Switch";
import { Toast, useToast } from "../components/Toast";
import { useLoader } from "../components/useLoader";
import { MODE_KINDS, usedFor } from "../modeKinds";
import { listPaymentModes, setPaymentModeActive } from "../paymentModesApi";
import type { PaymentMode } from "../types";
import { PHONE_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import styles from "../components/admin.module.css";
import { PaymentModeForm, type ModeFormMode } from "./PaymentModeForm";

const SUBTITLE =
  "How salary and advances can be paid. Cash is always available; everything here appears under Other when someone records a payment (desktop, phone and scanner). Admin only.";

type View = "all" | "active" | "off";

export function PaymentModesPage() {
  return (
    <AdminGate page="payment-modes" title="Payment modes" subtitle={SUBTITLE}>
      {() => <PaymentModesScreen />}
    </AdminGate>
  );
}

export function ModeIcon({ mode, small }: { mode: PaymentMode; small?: boolean }) {
  const kind = MODE_KINDS[mode.type];
  return (
    <span
      className={`${styles.modeIco} ${small ? styles.modeIcoSm : ""} ${mode.active ? "" : styles.modeIcoOff}`}
      style={{ background: kind.bg, color: kind.fg }}
      aria-hidden="true"
    >
      {kind.symbol}
    </span>
  );
}

function PaymentModesScreen() {
  const isPhone = useMediaQuery(PHONE_QUERY);
  const modes = useLoader(() => listPaymentModes(false));
  const { toast, show, dismiss } = useToast();
  const [view, setView] = useState<View>("all");
  const [form, setForm] = useState<ModeFormMode | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const all = useMemo(() => modes.data ?? [], [modes.data]);
  const cash = all.find((m) => m.is_builtin) ?? null;
  const others = all.filter((m) => !m.is_builtin);
  const rows = others.filter((m) =>
    view === "all" ? true : view === "active" ? m.active : !m.active,
  );
  const activeN = all.filter((m) => m.active).length;
  const offN = all.filter((m) => !m.active).length;

  const replace = (updated: PaymentMode) =>
    modes.setData((current) =>
      current ? current.map((m) => (m.id === updated.id ? updated : m)) : current,
    );

  const toggle = async (mode: PaymentMode) => {
    try {
      const updated = await setPaymentModeActive(mode.id, !mode.active);
      replace(updated);
      show(`${updated.name} turned ${updated.active ? "on" : "off"}`);
    } catch (err) {
      show(errorMessage(err), "danger");
    }
  };

  const onSaved = (mode: PaymentMode, created: boolean) => {
    setForm(null);
    if (created) {
      modes.setData((current) => (current ? [...current, mode] : current));
      setAdded(mode.name);
      show(`Added ${mode.name} — it now shows under Other`);
    } else {
      replace(mode);
      show(`Saved ${mode.name} — it now shows under Other`);
    }
  };

  const loadError = modes.error ? (
    <EmptyState icon="alert" title="Could not load payment modes" text={errorMessage(modes.error)}>
      <button type="button" className="btn" onClick={modes.reload}>
        Try again
      </button>
    </EmptyState>
  ) : null;

  const dialogs = (
    <>
      {form ? (
        <PaymentModeForm
          mode={form}
          modes={all}
          layout={isPhone ? "sheet" : "modal"}
          onClose={() => setForm(null)}
          onSaved={onSaved}
        />
      ) : null}
      <Toast toast={toast} onDismiss={dismiss} />
    </>
  );

  if (isPhone) {
    return (
      <div className={styles.stack}>
        <PageHeader title="Payment modes" subtitle="Settings · admin" />
        <div className={`card ${styles.mIntro}`}>
          <span className={styles.mIntroTitle}>Payment modes</span>
          <span className={styles.mIntroText}>
            These show under &quot;Other&quot; when paying salary or giving an advance. Cash is
            always available. Turn a mode off to hide it without losing old records.
          </span>
        </div>
        {loadError ?? (
          <div className={`card ${styles.mModes}`}>
            <div className={styles.mModeRow}>
              <span
                className={styles.modeIco}
                style={{ background: "#E6F5F3", color: "#0A5454", borderRadius: 10, width: 36, height: 36 }}
                aria-hidden="true"
              >
                Rs
              </span>
              <span className={styles.mModeText}>
                <span className={styles.mModeName}>Cash</span>
                <span className={styles.mModeSub}>Built in · always on</span>
              </span>
              <Icon name="lock" size={16} className="muted" />
            </div>
            {others.map((mode) => (
              <div key={mode.id} className={styles.mModeRow}>
                <ModeIcon mode={mode} />
                <span className={styles.mModeText}>
                  <span className={`${styles.mModeName} ${mode.active ? "" : styles.mModeOff}`}>
                    {mode.name}
                  </span>
                  <span className={styles.mModeSub}>
                    {mode.details ?? "—"} · {MODE_KINDS[mode.type].label}
                  </span>
                </span>
                <Switch
                  size="lg"
                  checked={mode.active}
                  onChange={() => void toggle(mode)}
                  label={`${mode.name} on or off`}
                />
              </div>
            ))}
            {modes.loading ? (
              <p className={styles.noMatch} style={{ padding: 12 }} role="status">
                Loading…
              </p>
            ) : null}
          </div>
        )}
        <button type="button" className={styles.mAddMode} onClick={() => setForm({ kind: "create" })}>
          <Icon name="plus" size={18} strokeWidth={2.4} />
          Add payment mode
        </button>
        {added ? (
          <div role="status" className={styles.mAdded}>
            {added} added — it now shows under &quot;Other&quot; when paying.
          </div>
        ) : null}
        {dialogs}
      </div>
    );
  }

  return (
    <div className={styles.stack}>
      <PageHeader
        title="Payment modes"
        subtitle={SUBTITLE}
        actions={
          <button type="button" className="btn btn--primary" onClick={() => setForm({ kind: "create" })}>
            <Icon name="plus" size={16} strokeWidth={2.2} />
            Add payment method
          </button>
        }
      />
      {loadError ?? (
        <section className={`card ${styles.modesCard}`} aria-labelledby="modes-heading">
          <div className={styles.modesHead}>
            <h2 id="modes-heading" className={styles.modesTitle}>
              {modes.loading ? "Loading…" : `${activeN} active · ${offN} off`}
            </h2>
            <Segmented<View>
              label="Show"
              value={view}
              onChange={setView}
              options={[
                { value: "all", label: "All" },
                { value: "active", label: "Active" },
                { value: "off", label: "Off" },
              ]}
            />
          </div>
          <div className={styles.tblWrap}>
            <table className={styles.tbl} style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th scope="col">Mode</th>
                  <th scope="col">Type</th>
                  <th scope="col">Details</th>
                  <th scope="col">Used for</th>
                  <th scope="col" className={styles.cellEnd}>
                    Payments
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {cash ? (
                  <tr>
                    <td>
                      <span className={styles.modeName}>
                        <ModeIcon mode={cash} />
                        Cash
                      </span>
                    </td>
                    <td>Cash</td>
                    <td className="muted">Built in</td>
                    <td>{usedFor(cash)}</td>
                    <td className={`mono ${styles.cellEnd}`}>{cash.payment_count}</td>
                    <td>
                      <span className={styles.lockPill}>
                        <Icon name="lock" size={13} />
                        Always on
                      </span>
                    </td>
                    <td />
                  </tr>
                ) : null}
                {rows.map((mode) => (
                  <tr key={mode.id} className={mode.active ? undefined : styles.rowOff}>
                    <td>
                      <span className={styles.modeName}>
                        <ModeIcon mode={mode} />
                        {mode.name}
                      </span>
                    </td>
                    <td>{MODE_KINDS[mode.type].label}</td>
                    <td className={styles.modeDetails}>{mode.details ?? "—"}</td>
                    <td>{usedFor(mode)}</td>
                    <td className={`mono ${styles.cellEnd}`}>{mode.payment_count}</td>
                    <td>
                      <span className={styles.statusCell}>
                        <Switch
                          checked={mode.active}
                          onChange={() => void toggle(mode)}
                          label={`${mode.name} on or off`}
                        />
                        <span className={styles.statusText}>{mode.active ? "On" : "Off"}</span>
                      </span>
                    </td>
                    <td className={styles.cellEnd}>
                      <button
                        type="button"
                        className={styles.editBtn}
                        style={{ minHeight: 32 }}
                        onClick={() => setForm({ kind: "edit", mode })}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!modes.loading && rows.length === 0 && others.length > 0 ? (
              <p className={styles.noMatch}>No modes are {view === "off" ? "off" : "active"}.</p>
            ) : null}
            {!modes.loading && others.length === 0 ? (
              <p className={styles.noMatch}>
                Only Cash so far. Add a bank, wallet, QR or cheque mode to offer it under Other.
              </p>
            ) : null}
          </div>
          <p className={styles.modesNote}>
            Turning a mode off hides it from new payments; old payments keep their mode. A mode
            that has payments can&apos;t be deleted, only turned off.
          </p>
        </section>
      )}
      {dialogs}
    </div>
  );
}
