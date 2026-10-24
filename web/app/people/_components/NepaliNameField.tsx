"use client";

import { Field, TextInput } from "./FormBits";
import { nepaliSuggestion } from "../_lib/devanagari";
import styles from "./payroll.module.css";

export interface NepaliNameFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** The Latin full name the suggestion is derived from. */
  fullName: string;
  error?: string | null;
  span2?: boolean;
}

/**
 * "Name in Nepali" with a suggested Devanagari spelling while the field is
 * empty (local transliteration, no API). The user accepts it with "Use",
 * types their own, or ignores it; a typed value is never overwritten.
 */
export function NepaliNameField({ id, value, onChange, fullName, error, span2 }: NepaliNameFieldProps) {
  const suggestion = nepaliSuggestion(fullName, value);
  return (
    <Field id={id} label="Name in Nepali (optional)" error={error} span2={span2}>
      <TextInput
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        lang="ne"
        placeholder="नाम देवनागरीमा"
        autoComplete="off"
        className={styles.npInput}
        invalid={Boolean(error)}
        aria-describedby={suggestion ? `${id}-suggest` : undefined}
      />
      {suggestion ? (
        <span id={`${id}-suggest`} className={styles.suggest} aria-live="polite">
          Suggested:{" "}
          <span className={styles.suggestText} lang="ne">
            {suggestion}
          </span>
          <button type="button" className={styles.suggestUse} onClick={() => onChange(suggestion)}>
            Use
          </button>
        </span>
      ) : null}
    </Field>
  );
}
