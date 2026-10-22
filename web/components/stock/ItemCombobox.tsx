"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { matchesSearch } from "./helpers";
import styles from "./entry.module.css";

export interface ItemOption {
  id: number;
  product: string;
  variation: string;
  stock: number;
}

export interface ItemComboboxProps {
  options: ItemOption[];
  value: number | null;
  onChange: (id: number | null) => void;
  label: string;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
}

export function optionLabel(o: ItemOption): string {
  return `${o.product} · ${o.variation}`;
}

/**
 * Searchable select for "Product · Variation": type words like "cooker 3"
 * to filter, arrow keys to move, Enter to pick. Plain input + listbox with
 * WAI-ARIA combobox semantics, no dependency.
 */
export function ItemCombobox({ options, value, onChange, label, invalid, describedBy, autoFocus }: ItemComboboxProps) {
  const id = useId();
  const selected = options.find((o) => o.id === value) ?? null;
  const [text, setText] = useState(selected ? optionLabel(selected) : "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!open) setText(selected ? optionLabel(selected) : "");
  }, [selected, open]);

  const matches = useMemo(() => {
    const query = open && selected && text === optionLabel(selected) ? "" : text;
    return options.filter((o) => matchesSearch(query, o.product, o.variation)).slice(0, 60);
  }, [options, text, open, selected]);

  useEffect(() => {
    setActive(0);
  }, [text]);

  const pick = (option: ItemOption) => {
    onChange(option.id);
    setText(optionLabel(option));
    setOpen(false);
  };

  return (
    <div className={styles.combo}>
      <div className={`field ${invalid ? styles.warnField : ""}`}>
        <input
          ref={inputRef}
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[active] ? `${id}-opt-${matches[active].id}` : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder="Type to find, e.g. cooker 3"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            if (selected && e.target.value !== optionLabel(selected)) onChange(null);
          }}
          onFocus={() => {
            if (blurTimer.current) window.clearTimeout(blurTimer.current);
            setOpen(true);
          }}
          onBlur={() => {
            blurTimer.current = window.setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              if (open && matches[active]) {
                e.preventDefault();
                pick(matches[active]);
              }
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
      </div>
      {open ? (
        <ul id={`${id}-list`} role="listbox" aria-label={label} className={styles.listbox}>
          {matches.length === 0 ? (
            <li className={styles.noMatch}>No item matches &quot;{text}&quot;.</li>
          ) : (
            matches.map((o, i) => (
              <li
                key={o.id}
                id={`${id}-opt-${o.id}`}
                role="option"
                aria-selected={o.id === value}
                className={`${styles.option} ${i === active ? styles.optionActive : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span>{optionLabel(o)}</span>
                <span className={styles.optionStock}>{o.stock} in stock</span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
