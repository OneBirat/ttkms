"use client";

import { useRef } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/ui/PageHeader";
import { SwitchDialog, useDialog } from "./EntryDialogs";
import { Lock, Tick } from "./EntryIcons";
import {
  adLongLine,
  bsNepaliLine,
  footerText,
  isRowLocked,
  LOCK_NP,
  rowQty,
  rowsValid,
  TYPE_TEXT,
} from "./entryLogic";
import { formatAdLong } from "./calendar";
import { ItemSelect, itemLabel } from "./ItemSelect";
import type { EntryForm, SavedResult } from "./StockEntryPage";
import type { EntryType, Movement } from "./types";
import styles from "./entry.module.css";

const TYPES: EntryType[] = ["purchase", "consumption"];

/** Desktop Stock entry (design/stock/StockEntry.dc.html). */
export function EntryDesktop({ form }: { form: EntryForm }) {
  const text = TYPE_TEXT[form.type];
  const isP = form.type === "purchase";
  const tone = isP ? styles.teal : styles.amber;
  const valid = rowsValid(form.rows);
  const usedIds = form.rows.map((r) => r.variationId).filter((id): id is number => id !== null);
  const footer = footerText(form.rows, form.saveTried);

  return (
    <>
      <PageHeader
        title="Stock entry"
        subtitle="One form for purchases and consumption. Opening stock is set when a product is added. All rows save together, or none do."
      />
      <div className={styles.layout}>
        <form
          className={`card ${styles.form}`}
          onSubmit={(e) => {
            e.preventDefault();
            void form.save();
          }}
        >
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Entry type</legend>
            <div className={styles.seg}>
              {TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={form.type === t}
                  onClick={() => form.requestType(t)}
                  className={`${styles.segButton} ${form.type === t ? (t === "purchase" ? styles.segTeal : styles.segAmber) : ""}`}
                >
                  {TYPE_TEXT[t].label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className={styles.dates}>
            <div className={styles.dateCol}>
              <label htmlFor="entry-ad" className={styles.dateLabel}>
                Date (AD)
              </label>
              <div className="field">
                <Icon name="calendar" size={16} />
                <input id="entry-ad" type="date" value={form.dateAd} onChange={(e) => form.setAd(e.target.value)} />
              </div>
              <span className={styles.dateNote}>{form.dateAd ? adLongLine(form.dateAd) : " "}</span>
            </div>
            <div className={styles.dateCol}>
              <label htmlFor="entry-bs" className={styles.dateLabel}>
                Date (BS){" "}
                <span lang="ne" className={styles.dateLabelNp}>
                  · मिति
                </span>
              </label>
              <div className={`field ${form.bs ? "" : styles.dateBad}`}>
                <Icon name="calendar" size={16} />
                <input
                  id="entry-bs"
                  inputMode="numeric"
                  placeholder="YYYY-MM-DD"
                  value={form.bsText}
                  onChange={(e) => form.setBsText(e.target.value)}
                  aria-invalid={!form.bs}
                  aria-describedby="entry-bs-note"
                />
              </div>
              <span id="entry-bs-note" className={styles.dateNote}>
                {form.bs ? (
                  <>
                    <span lang="ne">{bsNepaliLine(form.bs, form.dateAd)}</span> · changing either date updates the other
                  </>
                ) : (
                  "Enter the date as YYYY-MM-DD (Bikram Sambat)"
                )}
              </span>
            </div>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col" style={{ width: 28 }}>
                    #
                  </th>
                  <th scope="col">Item</th>
                  <th scope="col" className={styles.num} style={{ width: 90 }}>
                    In stock
                  </th>
                  <th scope="col" style={{ width: 150 }}>
                    Quantity
                  </th>
                  <th scope="col">Remarks</th>
                  <th scope="col" style={{ width: 44 }}>
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {form.rows.map((row, index) => {
                  const item = row.variationId === null ? null : (form.itemsById.get(row.variationId) ?? null);
                  const locked = isRowLocked(row);
                  const pointing = form.lock?.key === row.key;
                  const n = index + 1;
                  return (
                    <tr key={row.key}>
                      <td className={styles.rowIndex}>{n}</td>
                      <td className={styles.itemCell}>
                        <ItemSelect
                          row={n}
                          value={item}
                          open={form.openRowKey === row.key}
                          locked={locked}
                          excludeIds={usedIds.filter((id) => id !== row.variationId)}
                          onOpen={() => form.setOpenRowKey(row.key)}
                          onClose={() => form.setOpenRowKey(null)}
                          onPick={(picked) => {
                            form.updateRow(row.key, { variationId: picked.variation_id });
                            form.setOpenRowKey(null);
                          }}
                          onLocked={() => form.showLock(row.key)}
                        />
                      </td>
                      <td className={`${styles.num} ${styles.stockCell}`}>{item ? `${item.in_stock} pcs` : "–"}</td>
                      <td>
                        <div className={`field ${styles.qty}`}>
                          <input
                            aria-label={`Quantity, row ${n}`}
                            inputMode="numeric"
                            placeholder="0"
                            value={row.qty}
                            onChange={(e) => form.updateRow(row.key, { qty: e.target.value })}
                          />
                          <span>pcs</span>
                        </div>
                      </td>
                      <td>
                        <div className="field">
                          <input
                            aria-label={`Remarks, row ${n}`}
                            placeholder="Optional"
                            value={row.remarks}
                            onChange={(e) => form.updateRow(row.key, { remarks: e.target.value })}
                          />
                        </div>
                      </td>
                      <td>
                        <div className={styles.deleteWrap}>
                          {pointing ? (
                            <span aria-hidden="true" className={styles.pointer}>
                              👉
                            </span>
                          ) : null}
                          <button
                            type="button"
                            aria-label={`Remove row ${n}`}
                            className={`${styles.deleteButton} ${pointing ? styles.deletePulse : ""}`}
                            onClick={() => form.removeRow(row.key)}
                          >
                            <Icon name="trash" size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {form.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className={styles.emptyCell}>
                      <div className={styles.emptyTitle}>No rows yet</div>
                      {isP ? 'Click "Add purchase" and pick the items you purchased.' : 'Click "Add consumption" for each item sold or used.'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className={styles.addWrap}>
            <button type="button" className={`${styles.addButton} ${isP ? styles.addTeal : styles.addAmber}`} onClick={() => form.addRow()}>
              <Icon name="plus" size={18} />
              <span className={styles.addLabel}>
                {text.add} · {text.addNp}
              </span>
            </button>
          </div>

          {form.error ? (
            <p role="alert" className={styles.errorText}>
              {form.error}
            </p>
          ) : null}

          <div className={styles.footer}>
            <span className={`${styles.footerText} ${form.saveTried && !valid && form.rows.length > 0 ? styles.footerBad : ""}`} aria-live="polite">
              {footer}
            </span>
            <div className={styles.actions}>
              <button type="button" className="btn" onClick={form.clearRows}>
                Clear
              </button>
              <button
                type="submit"
                aria-disabled={!form.canSave}
                className={`${styles.saveButton} ${tone} ${form.canSave ? "" : styles.saveOff}`}
              >
                {form.saving ? "Saving…" : text.save}
              </button>
            </div>
          </div>
        </form>

        <TodayPanel form={form} />
      </div>

      <SavedDialog result={form.result} form={form} />
      {form.lock ? (
        <div role="alert" className={styles.lockToast}>
          <span className={styles.lockIconWrap}>
            <Lock size={18} strokeWidth={2.2} />
          </span>
          <div className={styles.lockText}>
            <span className={styles.lockTitle}>Item can&apos;t be changed</span>
            <span className={styles.lockBody}>Row {form.lock.row} already has a quantity. Delete this row and add a new item instead.</span>
            <span className={styles.lockNp} lang="ne">
              {LOCK_NP}
            </span>
          </div>
          <button type="button" aria-label="Dismiss" className={styles.lockClose} onClick={form.closeLock}>
            ×
          </button>
        </div>
      ) : null}
      <SwitchDialog to={form.switchTo} rowCount={form.rows.length} noun="row" onKeep={form.keepEditing} onClear={form.clearAndSwitch} />
    </>
  );
}

/** "Anita · 10:42" / "Counter sale · Bikash · 11:20" / "You · just now". */
export function entryMeta(m: Movement, justSaved: Set<number>): string {
  const who = justSaved.has(m.id) ? "You · just now" : `${m.entered_by} · ${m.time}`;
  return m.remarks ? `${m.remarks} · ${who}` : who;
}

function TodayPanel({ form }: { form: EntryForm }) {
  const isP = form.panelType === "purchase";
  const totals = form.todayEntries ? (isP ? form.todayEntries.purchases : form.todayEntries.consumptions) : null;
  const list = form.todayEntries?.entries.filter((e) => e.type === form.panelType) ?? [];
  return (
    <aside aria-labelledby="recent-h" className={`card ${styles.aside}`}>
      <div className={styles.asideHead}>
        <h2 id="recent-h">Today&apos;s entries</h2>
        <span>{form.today?.bs_text ?? ""}</span>
      </div>
      <div role="group" aria-label="Show entries for" className={styles.switch}>
        <div aria-hidden="true" className={`${styles.knob} ${isP ? "" : styles.knobRight}`} />
        <button type="button" aria-pressed={isP} onClick={() => form.setPanelType("purchase")}>
          Purchase
        </button>
        <button type="button" aria-pressed={!isP} onClick={() => form.setPanelType("consumption")}>
          Consumption
        </button>
      </div>
      <div className={styles.totals}>
        <div className={`${styles.tint} ${isP ? styles.tintIn : styles.tintOut}`}>
          <span className={styles.tintLabel}>Entries</span>
          <span className={styles.totalValue}>{totals?.count ?? "…"}</span>
        </div>
        <div className={`${styles.tint} ${isP ? styles.tintIn : styles.tintOut}`}>
          <span className={styles.tintLabel}>Total quantity</span>
          <span className={`${styles.totalValue} ${isP ? styles.inkTeal : styles.inkAmber}`}>{totals ? `${totals.total_quantity} pcs` : "…"}</span>
        </div>
      </div>
      <div className={styles.list} aria-busy={form.entriesLoading}>
        {form.todayEntries && list.length === 0 ? <p className={styles.hint}>No {form.panelType} entries yet today.</p> : null}
        {list.map((e) => (
          <div key={e.id} className={styles.entry}>
            <div className={styles.entryText}>
              <span>{itemLabel(e)}</span>
              <span className={styles.entryMeta}>{entryMeta(e, form.justSaved)}</span>
            </div>
            <span className={`${styles.badge} ${isP ? styles.badgeIn : styles.badgeOut}`}>
              {isP ? "+" : "−"}
              {e.quantity}
            </span>
          </div>
        ))}
      </div>
      <Link href="/stock/report" style={{ fontSize: 14 }}>
        Full stock report
      </Link>
    </aside>
  );
}

function SavedDialog({ result, form }: { result: SavedResult | null; form: EntryForm }) {
  const ref = useDialog(result !== null, form.dismissResult);
  const buttonRef = useRef<HTMLButtonElement>(null);
  if (!result) return null;
  const t = TYPE_TEXT[result.type];
  const isP = result.type === "purchase";
  const saved = result.response.saved;
  const total = saved.reduce((a, m) => a + m.quantity, 0);
  const todayText = form.today && form.today.bs === result.date_bs ? form.today.bs_text : result.date_bs;
  return (
    <div className={`${styles.backdrop} ${styles.backdropTop}`}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="sv-h" className={`${styles.savedBox} ${isP ? styles.savedTeal : styles.savedAmber}`} tabIndex={-1}>
        <div className={styles.savedHead}>
          <span className={`${styles.savedIcon} ${isP ? styles.bgTeal : styles.bgAmber}`}>
            <Tick size={30} strokeWidth={2.6} />
          </span>
          <h2 id="sv-h" className={styles.savedTitle}>
            {t.saved}
          </h2>
          <span className={styles.savedNp} lang="ne">
            {t.savedNp}
          </span>
          <span className={styles.savedSub}>
            {saved.length} item(s) · {t.sign}
            {total} pcs · {todayText} ({formatAdLong(result.date_ad)})
          </span>
        </div>
        <div className={styles.savedBody}>
          <div className={styles.savedList}>
            <span className={styles.savedListTitle}>Just saved</span>
            {saved.map((m) => (
              <div key={m.id} className={styles.savedRow}>
                <span>{itemLabel(m)}</span>
                <span className={`${styles.savedQty} ${isP ? styles.inkTeal : styles.inkAmber}`}>
                  {t.sign}
                  {m.quantity} pcs
                </span>
              </div>
            ))}
          </div>
          <div className={styles.savedToday}>
            <span>
              {t.todayLabel} ({result.response.today.count} entries)
            </span>
            <span className={`${styles.savedBig} ${isP ? styles.inkTeal : styles.inkAmber}`}>
              {t.sign}
              {result.response.today.total_quantity} pcs
            </span>
          </div>
        </div>
        <div className={styles.savedButtons}>
          <button ref={buttonRef} type="button" className={`${styles.savedButton} ${isP ? styles.bgTeal : styles.bgAmber}`} onClick={form.dismissResult}>
            New entry
          </button>
        </div>
      </div>
    </div>
  );
}

export { rowQty };
