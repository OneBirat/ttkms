"use client";

import { useDateLang } from "./useDateLang";
import styles from "./date.module.css";

/** English / Nepali (Devanagari digits) switch for every date on the page; saved per user in localStorage. */
export function DateLangToggle({ className }: { className?: string }) {
  const [lang, setLang] = useDateLang();
  return (
    <span className={`${styles.langToggle}${className ? ` ${className}` : ""}`} role="group" aria-label="Date language">
      <button type="button" className={styles.langBtn} aria-pressed={lang === "en"} onClick={() => setLang("en")}>
        EN
      </button>
      <button type="button" className={styles.langBtn} lang="ne" aria-pressed={lang === "ne"} onClick={() => setLang("ne")}>
        ने
      </button>
    </span>
  );
}
