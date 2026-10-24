"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Lang } from "@/lib/bs";

/** localStorage key of the English / Nepali date preference (per browser, per user device). */
export const DATE_LANG_KEY = "ttk.dateLang";
const EVENT = "ttk:dateLang";

function read(): Lang {
  if (typeof window === "undefined") return "en";
  try {
    return window.localStorage.getItem(DATE_LANG_KEY) === "ne" ? "ne" : "en";
  } catch {
    return "en";
  }
}

export function setDateLang(lang: Lang): void {
  try {
    window.localStorage.setItem(DATE_LANG_KEY, lang);
  } catch {
    // Private mode: the toggle still works for this page through the event below.
  }
  window.dispatchEvent(new Event(EVENT));
}

/**
 * The user's date language ("en" or "ne": Nepali names and Devanagari digits), saved in
 * localStorage. The server snapshot is "en" so hydration matches; the saved value applies right
 * after. Every <BSDate> on the page follows it unless given an explicit `lang`.
 */
export function useDateLang(): [Lang, (lang: Lang) => void] {
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  const lang = useSyncExternalStore(subscribe, read, () => "en" as Lang);
  return [lang, setDateLang];
}
