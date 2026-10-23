"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import * as api from "./api";
import { bsToAd, formatBsIso, type BsDate } from "./calendar";
import { EntryDesktop } from "./EntryDesktop";
import { EntryMobile } from "./EntryMobile";
import { digitsOnly, parseBsText, rowsValid, safeAdToBs, type FormRow } from "./entryLogic";
import { isValidTime, nowTimeKathmandu } from "./pickerLogic";
import { messageOf, useAsync } from "./useAsync";
import { useMediaQuery } from "./useMediaQuery";
import type { EntryResponse, EntryType, StockItem, StockToday, TodayEntries } from "./types";
import "./entry.global.css";

export const MOBILE_QUERY = "(max-width: 640px)";

export interface SavedResult {
  type: EntryType;
  response: EntryResponse;
  date_bs: string;
  date_ad: string;
}

export interface LockState {
  key: number;
  /** 1-based row number for the message. */
  row: number;
  id: number;
}

/** Everything both layouts of the form share. */
export interface EntryForm {
  type: EntryType;
  /** Ask to switch; blocked (switchTo set) while there are unsaved rows. */
  requestType: (type: EntryType) => void;
  switchTo: EntryType | null;
  keepEditing: () => void;
  clearAndSwitch: () => void;

  dateAd: string;
  bsText: string;
  bs: BsDate | null;
  setAd: (ad: string) => void;
  setBsText: (text: string) => void;
  /** "HH:MM" the entries are recorded at (date & time picker); defaults to now. */
  time: string;
  setTime: (time: string) => void;

  rows: FormRow[];
  /** Desktop: a blank row, returned so its dropdown can be opened. */
  addRow: () => number;
  /** Phone: add the item with quantity 1, or +1 when it is already listed. */
  addItem: (variationId: number) => void;
  updateRow: (key: number, patch: Partial<Omit<FormRow, "key">>) => void;
  removeRow: (key: number) => void;
  clearRows: () => void;

  openRowKey: number | null;
  setOpenRowKey: (key: number | null) => void;
  lock: LockState | null;
  showLock: (key: number) => void;
  closeLock: () => void;

  saveTried: boolean;
  saving: boolean;
  error: string | null;
  canSave: boolean;
  save: () => Promise<void>;
  result: SavedResult | null;
  dismissResult: () => void;

  items: StockItem[];
  itemsById: Map<number, StockItem>;
  today: StockToday | null;
  todayEntries: TodayEntries | null;
  entriesLoading: boolean;
  /** Movement ids saved in this session: shown as "You · just now". */
  justSaved: Set<number>;
  panelType: EntryType;
  setPanelType: (type: EntryType) => void;
}

let rowSeq = 1;
const blankRow = (variationId: number | null = null, qty = ""): FormRow => ({ key: rowSeq++, variationId, qty, remarks: "" });

const LOCK_MS = 5000;

function useEntryForm(): EntryForm {
  // /stock/entry?type=purchase&item=<variation id> (dashboard links) preselects the form.
  const params = useSearchParams();
  const presetType = params.get("type");
  const presetItem = Number(params.get("item")) || null;

  const [version, setVersion] = useState(0);
  const todayState = useAsync(() => api.getToday(), "today");
  const itemsState = useAsync(() => api.listItems(""), `items:${version}`);
  const entriesState = useAsync(() => api.getTodayEntries(null), `entries:${version}`);

  const [type, setType] = useState<EntryType>(presetType === "consumption" ? "consumption" : "purchase");
  const [switchTo, setSwitchTo] = useState<EntryType | null>(null);
  const [dateAd, setDateAd] = useState("");
  const [bsText, setBsTextState] = useState("");
  const [time, setTime] = useState(() => nowTimeKathmandu());
  const [rows, setRows] = useState<FormRow[]>(() => (presetItem ? [blankRow(presetItem)] : []));
  const [openRowKey, setOpenRowKey] = useState<number | null>(null);
  const [lock, setLock] = useState<LockState | null>(null);
  const lockTimer = useRef<number | null>(null);
  const [saveTried, setSaveTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SavedResult | null>(null);
  const [justSaved, setJustSaved] = useState<Set<number>>(() => new Set());
  const [panelType, setPanelType] = useState<EntryType>(type);

  const today = todayState.data ?? null;
  useEffect(() => {
    if (today && !dateAd) {
      setDateAd(today.ad);
      setBsTextState(today.bs);
    }
  }, [today, dateAd]);

  const bs = useMemo(() => parseBsText(bsText), [bsText]);

  const setAd = useCallback((ad: string) => {
    setDateAd(ad);
    const converted = safeAdToBs(ad);
    if (converted) setBsTextState(formatBsIso(converted));
  }, []);

  const setBsText = useCallback((text: string) => {
    setBsTextState(text);
    const parsed = parseBsText(text);
    if (parsed) setDateAd(bsToAd(parsed));
  }, []);

  const requestType = useCallback(
    (next: EntryType) => {
      if (next === type) return;
      if (rows.length > 0) {
        setSwitchTo(next);
        return;
      }
      setType(next);
      setSaveTried(false);
    },
    [type, rows.length],
  );

  const clearRows = useCallback(() => {
    setRows([]);
    setOpenRowKey(null);
    setLock(null);
    setSaveTried(false);
    setError(null);
  }, []);

  const clearAndSwitch = useCallback(() => {
    if (switchTo) setType(switchTo);
    setSwitchTo(null);
    clearRows();
  }, [switchTo, clearRows]);

  const addRow = useCallback(() => {
    const row = blankRow();
    setRows((list) => [...list, row]);
    setOpenRowKey(row.key);
    return row.key;
  }, []);

  const addItem = useCallback((variationId: number) => {
    setRows((list) => {
      const existing = list.find((r) => r.variationId === variationId);
      if (existing) {
        return list.map((r) => (r === existing ? { ...r, qty: String((parseInt(r.qty, 10) || 0) + 1) } : r));
      }
      return [...list, blankRow(variationId, "1")];
    });
  }, []);

  const updateRow = useCallback((key: number, patch: Partial<Omit<FormRow, "key">>) => {
    setRows((list) =>
      list.map((r) => (r.key === key ? { ...r, ...patch, qty: patch.qty === undefined ? r.qty : digitsOnly(patch.qty) } : r)),
    );
  }, []);

  const removeRow = useCallback((key: number) => {
    setRows((list) => list.filter((r) => r.key !== key));
    setOpenRowKey((open) => (open === key ? null : open));
    setLock((current) => (current?.key === key ? null : current));
  }, []);

  const closeLock = useCallback(() => setLock(null), []);

  const showLock = useCallback(
    (key: number) => {
      const index = rows.findIndex((r) => r.key === key);
      const id = Date.now();
      setOpenRowKey(null);
      setLock({ key, row: index + 1, id });
      if (lockTimer.current) window.clearTimeout(lockTimer.current);
      lockTimer.current = window.setTimeout(() => {
        setLock((current) => (current?.id === id ? null : current));
      }, LOCK_MS);
    },
    [rows],
  );

  useEffect(
    () => () => {
      if (lockTimer.current) window.clearTimeout(lockTimer.current);
    },
    [],
  );

  const canSave = rowsValid(rows) && bs !== null && isValidTime(time) && !saving;

  const save = useCallback(async () => {
    if (!rowsValid(rows) || !bs || !isValidTime(time)) {
      setSaveTried(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await api.saveEntry({
        type,
        date_bs: bsText,
        date_ad: dateAd,
        time,
        rows: rows.map((r) => ({ variation_id: r.variationId as number, qty: parseInt(r.qty, 10), remark: r.remarks.trim() || null })),
      });
      setResult({ type, response, date_bs: bsText, date_ad: dateAd });
      setJustSaved((set) => new Set([...set, ...response.saved.map((m) => m.id)]));
      setRows([]);
      setOpenRowKey(null);
      setLock(null);
      setSaveTried(false);
      setPanelType(type);
      setTime(nowTimeKathmandu());
      setVersion((n) => n + 1);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setSaving(false);
    }
  }, [rows, bs, type, bsText, dateAd, time]);

  const dismissResult = useCallback(() => setResult(null), []);

  const items = useMemo(() => itemsState.data?.items ?? [], [itemsState.data]);
  const itemsById = useMemo(() => new Map(items.map((i) => [i.variation_id, i])), [items]);

  return {
    type,
    requestType,
    switchTo,
    keepEditing: () => setSwitchTo(null),
    clearAndSwitch,
    dateAd,
    bsText,
    bs,
    setAd,
    setBsText,
    time,
    setTime,
    rows,
    addRow,
    addItem,
    updateRow,
    removeRow,
    clearRows,
    openRowKey,
    setOpenRowKey,
    lock,
    showLock,
    closeLock,
    saveTried,
    saving,
    error,
    canSave,
    save,
    result,
    dismissResult,
    items,
    itemsById,
    today,
    todayEntries: entriesState.data ?? null,
    entriesLoading: entriesState.loading,
    justSaved,
    panelType,
    setPanelType,
  };
}

/**
 * /stock/entry — one form for purchases and consumption. Desktop layout
 * (design/stock/StockEntry.dc.html) above 640px, phone layout
 * (StockEntryMobile.dc.html) below it; both drive the same state.
 */
export function StockEntryPage() {
  const form = useEntryForm();
  const mobile = useMediaQuery(MOBILE_QUERY);

  // The phone layout brings its own header and menu drawer, so the shared
  // sidebar is hidden while it is shown (see entry.global.css).
  useEffect(() => {
    if (!mobile) return;
    document.documentElement.setAttribute("data-stock-mobile", "");
    return () => document.documentElement.removeAttribute("data-stock-mobile");
  }, [mobile]);

  if (mobile === null) return null;
  return mobile ? <EntryMobile form={form} /> : <EntryDesktop form={form} />;
}
