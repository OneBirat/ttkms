"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { ChevronDown, ChevronUp, Lock } from "./EntryIcons";
import * as api from "./api";
import { stockTone } from "./entryLogic";
import type { StockItem } from "./types";
import styles from "./entry.module.css";

export interface ItemSelectProps {
  /** 1-based row number, for labels. */
  row: number;
  value: StockItem | null;
  open: boolean;
  /** Item and quantity set: the item can't change any more. */
  locked: boolean;
  /** Variations used by other rows; the list never offers them. */
  excludeIds: number[];
  onOpen: () => void;
  onClose: () => void;
  onPick: (item: StockItem) => void;
  /** Clicking a locked field: the page shows the pop-up and points at Delete. */
  onLocked: () => void;
}

export function itemLabel(item: Pick<StockItem, "product_name" | "variation_name">): string {
  return `${item.product_name} · ${item.variation_name}`;
}

const STOCK_CLASS = { out: styles.stockOut, low: styles.stockLow, ok: styles.stockOk } as const;

/**
 * The item cell of a Stock entry row. Closed it is a button showing the item;
 * open it becomes a search box (GET /api/stock/items?search=&exclude_ids=)
 * with the matching items listed underneath.
 */
export function ItemSelect({ row, value, open, locked, excludeIds, onOpen, onClose, onPick, onLocked }: ItemSelectProps) {
  const id = useId();
  const label = `Item, row ${row}`;
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<StockItem[] | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const excludeKey = excludeIds.join(",");

  useEffect(() => {
    if (!open) {
      setQuery("");
      setItems(null);
      return;
    }
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let stale = false;
    api
      .listItems(query, excludeKey ? excludeKey.split(",").map(Number) : [])
      .then((r) => {
        if (!stale) {
          setItems(r.items);
          setActive(0);
        }
      })
      .catch(() => {
        if (!stale) setItems([]);
      });
    return () => {
      stale = true;
    };
  }, [open, query, excludeKey]);

  const toggle = () => {
    if (locked) {
      onLocked();
      return;
    }
    if (open) onClose();
    else onOpen();
  };

  if (!open) {
    return (
      <>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={false}
          aria-label={label}
          onClick={toggle}
          className={`${styles.itemButton} ${locked ? styles.itemLocked : ""} ${value ? "" : styles.itemEmpty}`}
        >
          <span className={styles.itemText}>{value ? itemLabel(value) : "Select item…"}</span>
          {locked ? (
            <span title="Locked: quantity entered" className={styles.lockIcon}>
              <Lock size={14} />
            </span>
          ) : null}
          <span className={styles.chevron} aria-hidden="true">
            <ChevronDown size={16} />
          </span>
        </button>
        {value ? null : <div className={styles.itemHint}>Pick an item first</div>}
      </>
    );
  }

  const list = items ?? [];
  return (
    <>
      <div className={styles.itemSearch}>
        <Icon name="search" size={16} />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={list[active] ? `${id}-opt-${list[active].variation_id}` : undefined}
          aria-label={label}
          autoComplete="off"
          placeholder={value ? `${itemLabel(value)} — type to change` : "Type to search, e.g. cooker 3"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, list.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (list[active]) onPick(list[active]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <button type="button" aria-label="Close list" onClick={onClose} className={styles.closeList}>
          <ChevronUp size={16} />
        </button>
      </div>
      <div className={styles.listWrap}>
        <div id={`${id}-list`} role="listbox" aria-label={label} className={styles.list}>
          {list.map((item, i) => (
            <button
              type="button"
              role="option"
              key={item.variation_id}
              id={`${id}-opt-${item.variation_id}`}
              aria-selected={i === active}
              className={`${styles.option} ${i === active ? styles.optionActive : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(item)}
            >
              <span>{itemLabel(item)}</span>
              <span className={`${styles.optionStock} ${STOCK_CLASS[stockTone(item.in_stock)]}`}>{item.in_stock} pcs</span>
            </button>
          ))}
          {items && list.length === 0 ? (
            <div className={styles.noMatch}>
              {query.trim() ? (
                <>
                  No item matches &quot;{query.trim()}&quot;. Ask an admin to add it.
                </>
              ) : (
                "All items are already in the list."
              )}
            </div>
          ) : null}
          {items === null ? <div className={styles.noMatch}>Loading…</div> : null}
        </div>
      </div>
    </>
  );
}
