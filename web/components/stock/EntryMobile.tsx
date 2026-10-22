"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";
import { isActivePath } from "@/components/Sidebar";
import { useSession } from "@/lib/session";
import * as api from "./api";
import { SwitchDialog, useDialog } from "./EntryDialogs";
import { ArrowRight, Package, Pencil, Tick } from "./EntryIcons";
import { itemLabel } from "./ItemSelect";
import { entryMeta } from "./EntryDesktop";
import { WEEKDAY_NAMES_NP } from "./calendar";
import { KEYPAD_KEYS, keypadPress, rowQty, rowsValid, saveCaption, stockTone, totalQty, TYPE_TEXT, type KeypadKey } from "./entryLogic";
import type { EntryForm, SavedResult } from "./StockEntryPage";
import type { EntryType, StockItem } from "./types";
import shared from "./entry.module.css";
import styles from "./entryMobile.module.css";

type View = "new" | "today";
type TodayFilter = "all" | "purchase" | "consumption";

const STOCK_CLASS = { out: styles.stockOut, low: styles.stockLow, ok: styles.stockOk } as const;

/** Phone Stock entry (design/stock/StockEntryMobile*.dc.html), shown below 640px. */
export function EntryMobile({ form }: { form: EntryForm }) {
  const [view, setView] = useState<View>("new");
  const [menu, setMenu] = useState(false);
  const [picker, setPicker] = useState(false);
  const [pad, setPad] = useState<{ key: number; value: string } | null>(null);
  const [filter, setFilter] = useState<TodayFilter>("all");

  const isP = form.type === "purchase";
  const text = TYPE_TEXT[form.type];
  const total = totalQty(form.rows);
  const blocked = !rowsValid(form.rows) || form.saving;
  const todayCount = form.todayEntries?.entries.length ?? 0;
  const weekdayNp = form.today ? WEEKDAY_NAMES_NP[form.today.weekday] : "";
  // "कार्तिक ४" from "मंगलबार, कार्तिक ४, २०८३"
  const bsShortNp = form.today ? form.today.bs_text_np.replace(/^[^,]+,\s*/, "").replace(/,\s*[०-९]+$/, "") : "";

  const padRow = pad ? form.rows.find((r) => r.key === pad.key) : undefined;
  const padItem = padRow && padRow.variationId !== null ? form.itemsById.get(padRow.variationId) : undefined;

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.headerRow}>
          <button type="button" aria-label="Open menu" aria-expanded={menu} className={styles.menuButton} onClick={() => setMenu(true)}>
            <Icon name="menu" size={22} />
          </button>
          <div className={styles.headerText}>
            <span className={styles.headerTitle}>Stock entry</span>
            <span className={styles.headerDate}>
              {form.today ? (
                <>
                  <span lang="ne">
                    {weekdayNp}, {bsShortNp}
                  </span>{" "}
                  · {form.today.bs_text}
                </>
              ) : (
                " "
              )}
            </span>
          </div>
        </div>
        <div role="group" aria-label="View" className={styles.tabs}>
          <button type="button" aria-pressed={view === "new"} className={styles.tab} onClick={() => setView("new")}>
            New entry
          </button>
          <button type="button" aria-pressed={view === "today"} className={styles.tab} onClick={() => setView("today")}>
            Today · {todayCount}
          </button>
        </div>
      </header>

      {view === "new" ? (
        <>
          <div className={styles.scroll}>
            <div role="group" aria-label="Entry type" className={styles.switch}>
              <div aria-hidden="true" className={`${styles.knob} ${isP ? "" : styles.knobRight}`} />
              <button type="button" aria-pressed={isP} className={styles.switchButton} onClick={() => form.requestType("purchase")}>
                <span>Purchase</span>
                <span lang="ne" className={styles.switchNp}>
                  खरिद
                </span>
              </button>
              <button type="button" aria-pressed={!isP} className={styles.switchButton} onClick={() => form.requestType("consumption")}>
                <span>Consumption</span>
                <span lang="ne" className={styles.switchNp}>
                  खपत
                </span>
              </button>
            </div>

            <div className={styles.dateCard}>
              <label htmlFor="m-date" className={styles.dateLabel}>
                Date (BS)
              </label>
              <div className={`${styles.dateField} ${form.bs ? "" : styles.dateBad}`}>
                <Icon name="calendar" size={16} />
                <input
                  id="m-date"
                  inputMode="numeric"
                  placeholder="YYYY-MM-DD"
                  value={form.bsText}
                  onChange={(e) => form.setBsText(e.target.value)}
                  aria-invalid={!form.bs}
                  className={styles.dateInput}
                />
              </div>
            </div>

            <div className={styles.itemsHead}>
              <h2 className={styles.itemsTitle}>Items · {form.rows.length}</h2>
              <span className={styles.itemsTotal}>{total} pcs total</span>
            </div>

            {form.rows.map((row) => {
              const item = row.variationId === null ? null : (form.itemsById.get(row.variationId) ?? null);
              const qty = rowQty(row);
              const over = !isP && item !== null && qty > item.in_stock;
              const warn = qty <= 0 || over;
              const name = item ? `${item.product_name} ${item.variation_name}` : "row";
              return (
                <div key={row.key} className={`${styles.itemCard} ${warn ? styles.itemCardWarn : ""}`}>
                  <div className={styles.itemCardHead}>
                    <div className={styles.itemCardText}>
                      <span className={styles.itemProduct}>{item?.product_name ?? "…"}</span>
                      <span className={styles.itemVariation}>
                        {item?.variation_name ?? ""} ·{" "}
                        <span className={item ? STOCK_CLASS[stockTone(item.in_stock)] : ""}>in stock {item?.in_stock ?? "–"} pcs</span>
                      </span>
                    </div>
                    <button type="button" aria-label={`Remove ${name}`} className={styles.removeButton} onClick={() => form.removeRow(row.key)}>
                      <Icon name="trash" size={18} />
                    </button>
                  </div>
                  <div className={styles.stepper}>
                    <button
                      type="button"
                      className={styles.step}
                      aria-label={`Decrease ${name}`}
                      onClick={() => form.updateRow(row.key, { qty: String(Math.max(0, qty - 1)) })}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      aria-label={`Type quantity for ${name}, now ${qty}`}
                      className={styles.qtyButton}
                      onClick={() => setPad({ key: row.key, value: "" })}
                    >
                      <span className={styles.qtyValue}>{qty}</span>
                      <span className={styles.qtyUnit}>pcs</span>
                      <Pencil size={14} className={styles.qtyPencil} />
                    </button>
                    <button type="button" className={styles.step} aria-label={`Increase ${name}`} onClick={() => form.updateRow(row.key, { qty: String(qty + 1) })}>
                      +
                    </button>
                  </div>
                  {warn ? (
                    <span role="alert" className={styles.warnText}>
                      {qty <= 0 ? "Enter a quantity above 0." : `Only ${item?.in_stock} pcs in stock. You can still save, but stock will go negative.`}
                    </span>
                  ) : null}
                  <div className={styles.remarkField}>
                    <input
                      aria-label={`Remarks for ${name}`}
                      placeholder="Remarks (optional)"
                      value={row.remarks}
                      onChange={(e) => form.updateRow(row.key, { remarks: e.target.value })}
                    />
                  </div>
                </div>
              );
            })}

            {form.rows.length === 0 ? (
              <div className={styles.empty}>
                <div className={`${styles.emptyIcon} ${isP ? styles.emptyTeal : styles.emptyAmber}`}>
                  <Package size={30} strokeWidth={1.8} />
                </div>
                <span className={styles.emptyTitle}>No items yet</span>
                <span className={styles.emptyHint}>
                  {isP
                    ? 'Tap "Add purchase" and search, e.g. "cooker 3". Add every item purchased, then save once.'
                    : 'Tap "Add consumption" for each product sold or used today, then save once.'}
                </span>
              </div>
            ) : null}

            <button type="button" className={`${styles.addButton} ${isP ? shared.addTeal : shared.addAmber}`} onClick={() => setPicker(true)}>
              <Icon name="plus" size={18} />
              {text.add}
            </button>
            {form.error ? (
              <p role="alert" className={shared.errorText}>
                {form.error}
              </p>
            ) : null}
          </div>

          <div className={styles.saveBar}>
            <div className={styles.saveText}>
              <span className={styles.saveCaption}>{saveCaption(form.rows)}</span>
              <span className={`${styles.saveTotal} ${isP ? shared.inkTeal : shared.inkAmber}`}>
                {text.sign}
                {total} pcs
              </span>
            </div>
            <button
              type="button"
              aria-disabled={blocked}
              className={`${styles.saveButton} ${blocked ? styles.saveButtonOff : isP ? shared.bgTeal : shared.bgAmber}`}
              onClick={() => {
                if (!blocked) void form.save();
              }}
            >
              {form.saving ? "Saving…" : text.save}
            </button>
          </div>
        </>
      ) : (
        <TodayView form={form} filter={filter} setFilter={setFilter} />
      )}

      {picker ? (
        <PickerSheet
          type={form.type}
          rows={form.rows}
          onPick={(item) => {
            form.addItem(item.variation_id);
            setPicker(false);
          }}
          onClose={() => setPicker(false)}
        />
      ) : null}

      {pad && padRow ? (
        <KeypadSheet
          type={form.type}
          title={padItem ? itemLabel(padItem) : "Quantity"}
          stock={padItem?.in_stock ?? null}
          was={rowQty(padRow)}
          value={pad.value}
          onKey={(k) => setPad({ key: pad.key, value: keypadPress(pad.value, k) })}
          onDone={() => {
            form.updateRow(pad.key, { qty: String(parseInt(pad.value || "0", 10)) });
            setPad(null);
          }}
          onCancel={() => setPad(null)}
        />
      ) : null}

      {menu ? <MenuDrawer onClose={() => setMenu(false)} /> : null}

      <SwitchDialog to={form.switchTo} rowCount={form.rows.length} noun="item" onKeep={form.keepEditing} onClear={form.clearAndSwitch} />

      {form.result ? (
        <SavedScreen
          result={form.result}
          dateText={form.today && form.today.bs === form.result.date_bs ? form.today.bs_text : form.result.date_bs}
          onSkip={form.dismissResult}
          onToday={() => {
            setFilter(form.result?.type ?? "all");
            form.dismissResult();
            setView("today");
          }}
        />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------- Today tab

function TodayView({ form, filter, setFilter }: { form: EntryForm; filter: TodayFilter; setFilter: (f: TodayFilter) => void }) {
  const data = form.todayEntries;
  const all = data?.entries ?? [];
  const list = filter === "all" ? all : all.filter((e) => e.type === filter);
  const title =
    filter === "purchase"
      ? `Purchased today · ${data?.purchases.count ?? 0} items`
      : filter === "consumption"
        ? `Sold / used today · ${data?.consumptions.count ?? 0} items`
        : `All entries today · ${all.length}`;
  const toggle = (f: TodayFilter) => setFilter(filter === f ? "all" : f);
  return (
    <div className={styles.scrollToday} aria-busy={form.entriesLoading}>
      <div className={styles.todayCards}>
        <button
          type="button"
          aria-pressed={filter === "purchase"}
          className={`${styles.todayCard} ${styles.todayIn} ${filter === "purchase" ? styles.todayInOn : ""}`}
          onClick={() => toggle("purchase")}
        >
          <span className={styles.todayCardLabel}>Purchased today</span>
          <span className={`${styles.todayCardValue} ${shared.inkTeal}`}>+{data?.purchases.total_quantity ?? 0}</span>
          <span className={`${styles.todayCardFoot} ${shared.inkTeal}`}>
            {data?.purchases.count ?? 0} entries · {filter === "purchase" ? "Showing" : "View"}
            <ArrowRight size={14} />
          </span>
        </button>
        <button
          type="button"
          aria-pressed={filter === "consumption"}
          className={`${styles.todayCard} ${styles.todayOut} ${filter === "consumption" ? styles.todayOutOn : ""}`}
          onClick={() => toggle("consumption")}
        >
          <span className={styles.todayCardLabel}>Sold / used today</span>
          <span className={`${styles.todayCardValue} ${shared.inkAmber}`}>−{data?.consumptions.total_quantity ?? 0}</span>
          <span className={`${styles.todayCardFoot} ${shared.inkAmber}`}>
            {data?.consumptions.count ?? 0} entries · {filter === "consumption" ? "Showing" : "View"}
            <ArrowRight size={14} />
          </span>
        </button>
      </div>
      <div className={styles.todayHead}>
        <h2 className={styles.itemsTitle}>{title}</h2>
        {filter !== "all" ? (
          <button type="button" className={styles.showAll} onClick={() => setFilter("all")}>
            Show all
          </button>
        ) : null}
      </div>
      <div className={styles.todayList}>
        {data && list.length === 0 ? <p className={styles.todayEmpty}>No entries yet today.</p> : null}
        {list.map((e) => (
          <div key={e.id} className={styles.todayRow}>
            <div className={styles.todayRowText}>
              <span className={styles.todayItem}>{itemLabel(e)}</span>
              <span className={styles.todayMeta}>{entryMeta(e, form.justSaved)}</span>
            </div>
            <span className={`${styles.todayBadge} ${e.type === "purchase" ? shared.badgeIn : shared.badgeOut}`}>
              {e.type === "purchase" ? "+" : "−"}
              {e.quantity}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ Sheets

/** Bottom sheet: closes with × and by tapping the dimmed backdrop. */
function Sheet({ label, onClose, children, className }: { label: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useDialog(true, onClose);
  return (
    <div className={styles.sheetBackdrop} onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`${styles.sheet} ${className ?? ""}`}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <div className={styles.grabber}>
          <span />
        </div>
        {children}
      </div>
    </div>
  );
}

function PickerSheet({ type, rows, onPick, onClose }: { type: EntryType; rows: EntryForm["rows"]; onPick: (item: StockItem) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<StockItem[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inRows = useMemo(() => new Set(rows.map((r) => r.variationId)), [rows]);
  const text = TYPE_TEXT[type];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let stale = false;
    api
      .listItems(q)
      .then((r) => {
        if (!stale) setItems(r.items);
      })
      .catch(() => {
        if (!stale) setItems([]);
      });
    return () => {
      stale = true;
    };
  }, [q]);

  return (
    <Sheet label={text.add} onClose={onClose} className={styles.pickerSheet}>
      <div className={styles.sheetHead}>
        <h2 className={styles.sheetTitle}>{text.add}</h2>
        <button type="button" aria-label="Close" className={styles.sheetClose} onClick={onClose}>
          ×
        </button>
      </div>
      <div className={styles.pickerSearchWrap}>
        <div className={styles.pickerSearch}>
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            type="search"
            aria-label="Search product or variation"
            placeholder="Search, e.g. cooker 3"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
      <div className={styles.pickerList}>
        {(items ?? []).map((item) => {
          const added = inRows.has(item.variation_id);
          return (
            <button type="button" key={item.variation_id} className={styles.pickerOption} onClick={() => onPick(item)}>
              <span className={styles.pickerOptionText}>
                <span className={styles.pickerOptionName}>{itemLabel(item)}</span>
                <span className={styles.pickerOptionCode}>{added ? `${item.code} · already added, tap to add 1 more` : item.code}</span>
              </span>
              <span className={`${styles.pickerStock} ${STOCK_CLASS[stockTone(item.in_stock)]}`}>{item.in_stock} pcs</span>
            </button>
          );
        })}
        {items && items.length === 0 ? <p className={styles.pickerEmpty}>No item matches &quot;{q.trim()}&quot;. Ask an admin to add it.</p> : null}
        {items === null ? <p className={styles.pickerEmpty}>Loading…</p> : null}
      </div>
    </Sheet>
  );
}

function KeypadSheet({
  type,
  title,
  stock,
  was,
  value,
  onKey,
  onDone,
  onCancel,
}: {
  type: EntryType;
  title: string;
  stock: number | null;
  was: number;
  value: string;
  onKey: (key: KeypadKey) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const isP = type === "purchase";
  return (
    <Sheet label={`Quantity for ${title}`} onClose={onCancel} className={styles.padSheet}>
      <div className={styles.padHead}>
        <div className={styles.padHeadText}>
          <h2 className={styles.padTitle}>{title}</h2>
          <span className={`${styles.padStock} ${stock === null ? "" : STOCK_CLASS[stockTone(stock)]}`}>
            In stock {stock ?? "–"} pcs · was {was}
          </span>
        </div>
        <button type="button" aria-label="Cancel" className={styles.sheetClose} onClick={onCancel}>
          ×
        </button>
      </div>
      <div role="status" aria-live="polite" className={`${styles.padBox} ${isP ? styles.padBoxTeal : styles.padBoxAmber}`}>
        <span className={styles.padValue}>{value === "" ? "0" : value}</span>
        <span className={styles.padUnit}>pcs</span>
      </div>
      <div className={styles.padKeys}>
        {KEYPAD_KEYS.map((k) => {
          const fn = k === "C" || k === "del";
          return (
            <button
              type="button"
              key={k}
              aria-label={k === "C" ? "Clear" : k === "del" ? "Delete last digit" : k}
              className={`${styles.padKey} ${fn ? styles.padKeyFn : ""}`}
              onClick={() => onKey(k)}
            >
              {k === "del" ? "⌫" : k}
            </button>
          );
        })}
      </div>
      <button type="button" className={`${styles.padDone} ${isP ? shared.bgTeal : shared.bgAmber}`} onClick={onDone}>
        Done
      </button>
    </Sheet>
  );
}

// ------------------------------------------------------------ Menu

/** Left drawer with the same navigation as the desktop sidebar (module registry). */
function MenuDrawer({ onClose }: { onClose: () => void }) {
  const { user, modules, logout } = useSession();
  const pathname = usePathname();
  const ref = useDialog(true, onClose);
  const sections = modules.filter((m) => m.nav.length > 0);
  return (
    <div className={styles.drawerWrap}>
      <nav ref={ref} aria-label="Menu" className={styles.drawer} tabIndex={-1}>
        <div className={styles.drawerBrand}>
          <span className={styles.drawerTile} aria-hidden="true">
            TT
          </span>
          <span className={styles.drawerBrandText}>
            <span className={styles.drawerBrandName}>TTK Stock</span>
            <span className={styles.drawerBrandSub}>{user ? `${user.full_name} · ${user.role_label}` : ""}</span>
          </span>
          <button type="button" aria-label="Close menu" className={styles.drawerClose} onClick={onClose}>
            ×
          </button>
        </div>
        {sections.map((module, index) => (
          <div key={module.name}>
            <div className={styles.drawerSection}>{module.title}</div>
            {index === 0 ? (
              <Link href="/" className={styles.drawerLink} aria-current={pathname === "/" ? "page" : undefined} onClick={onClose}>
                <Icon name="dashboard" size={20} />
                Dashboard
              </Link>
            ) : null}
            {module.nav.map((item) => (
              <Link
                key={item.path}
                href={item.path}
                className={styles.drawerLink}
                aria-current={isActivePath(pathname, item.path) ? "page" : undefined}
                onClick={onClose}
              >
                <Icon name={item.icon} size={20} />
                {item.label}
              </Link>
            ))}
          </div>
        ))}
        <div className={styles.drawerSpacer} />
        <button type="button" className={styles.drawerLogout} onClick={() => void logout()}>
          <Icon name="logout" size={20} />
          Log out
        </button>
      </nav>
      <div aria-hidden="true" className={styles.drawerBackdrop} onClick={onClose} />
    </div>
  );
}

// ------------------------------------------------------------ Saved

function SavedScreen({ result, dateText, onSkip, onToday }: { result: SavedResult; dateText: string; onSkip: () => void; onToday: () => void }) {
  const ref = useDialog(true, onSkip);
  const t = TYPE_TEXT[result.type];
  const isP = result.type === "purchase";
  const saved = result.response.saved;
  const total = saved.reduce((a, m) => a + m.quantity, 0);
  return (
    <section
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-labelledby="msv-h"
      className={`${styles.savedScreen} ${isP ? shared.savedTeal : shared.savedAmber}`}
      tabIndex={-1}
    >
      <div className={styles.savedHead}>
        <span className={`${styles.savedIcon} ${isP ? shared.bgTeal : shared.bgAmber}`}>
          <Tick size={34} strokeWidth={2.6} />
        </span>
        <h2 id="msv-h" className={styles.savedTitle}>
          {t.saved}
        </h2>
        <span className={shared.savedNp} lang="ne">
          {t.savedNp}
        </span>
        <span className={shared.savedSub}>
          {saved.length} item(s) · {t.sign}
          {total} pcs · {dateText} · just now
        </span>
      </div>
      <div className={styles.savedBody}>
        <div className={styles.savedList}>
          <span className={shared.savedListTitle}>Just saved</span>
          {saved.map((m) => (
            <div key={m.id} className={shared.savedRow}>
              <span>{itemLabel(m)}</span>
              <span className={`${shared.savedQty} ${isP ? shared.inkTeal : shared.inkAmber}`}>
                {t.sign}
                {m.quantity}
              </span>
            </div>
          ))}
        </div>
        <div className={shared.savedToday}>
          <span>
            {t.todayLabel} ({result.response.today.count} entries)
          </span>
          <span className={`${shared.savedBig} ${isP ? shared.inkTeal : shared.inkAmber}`}>
            {t.sign}
            {result.response.today.total_quantity} pcs
          </span>
        </div>
      </div>
      <div className={styles.savedButtons}>
        <button type="button" className={`${styles.savedPrimary} ${isP ? shared.bgTeal : shared.bgAmber}`} onClick={onSkip}>
          Skip · back to entry
        </button>
        <button type="button" className={styles.savedSecondary} onClick={onToday}>
          View all of today
        </button>
      </div>
    </section>
  );
}
