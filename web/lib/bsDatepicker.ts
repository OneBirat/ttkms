"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Optional Nepali date-picker enhancement for <BsDateInput>.
 *
 * Nothing here runs unless NEXT_PUBLIC_BS_DATEPICKER=1, so no vendor file is
 * referenced while it does not exist. To enable it, copy
 * static/vendor/nepali.datepicker.v4.min.js (and its .css) to
 * web/public/vendor/ and set the flag in .env.local.
 *
 * TODO(vendor): confirm the API of nepali.datepicker.v4.min.js once it is in
 * public/vendor/. The code below assumes the v4 picker (no jQuery) that adds
 * `HTMLInputElement.prototype.nepaliDatePicker(options)` with an `onChange`
 * callback and writes the picked "YYYY-MM-DD" into the input's value. Adjust
 * the option names / script and stylesheet paths if the vendor file differs.
 */

export const BS_DATEPICKER_ENABLED =
  process.env.NEXT_PUBLIC_BS_DATEPICKER === "1";

const SCRIPT_SRC = "/vendor/nepali.datepicker.v4.min.js";
const STYLE_HREF = "/vendor/nepali.datepicker.v4.min.css";

interface PickerOptions {
  dateFormat?: string;
  ndpYear?: boolean;
  ndpMonth?: boolean;
  onChange?: () => void;
}

type PickerInput = HTMLInputElement & {
  nepaliDatePicker?: (options?: PickerOptions) => void;
};

let loader: Promise<void> | null = null;

function loadVendor(): Promise<void> {
  if (loader) return loader;
  loader = new Promise<void>((resolve, reject) => {
    if (!document.querySelector(`link[href="${STYLE_HREF}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = STYLE_HREF;
      document.head.appendChild(link);
    }
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_SRC}"]`,
    );
    if (existing?.dataset.loaded === "1") {
      resolve();
      return;
    }
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => {
      script.dataset.loaded = "1";
      resolve();
    });
    script.addEventListener("error", () =>
      reject(new Error(`Could not load ${SCRIPT_SRC}`)),
    );
    if (!existing) {
      script.src = SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return loader;
}

/**
 * Attaches the vendor picker to the referenced input when the feature flag is
 * on and the global picker exists. `onChange` receives the new value because
 * the picker writes to the DOM directly, bypassing React's synthetic events.
 */
export function useBsDatepicker(
  ref: RefObject<HTMLInputElement | null>,
  onChange?: (value: string) => void,
): void {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!BS_DATEPICKER_ENABLED) return;
    const input = ref.current as PickerInput | null;
    if (!input) return;
    let cancelled = false;
    loadVendor()
      .then(() => {
        if (cancelled || typeof input.nepaliDatePicker !== "function") return;
        input.nepaliDatePicker({
          dateFormat: "YYYY-MM-DD",
          ndpYear: true,
          ndpMonth: true,
          onChange: () => onChangeRef.current?.(input.value),
        });
      })
      .catch(() => {
        // The plain text input keeps working without the picker.
      });
    return () => {
      cancelled = true;
    };
  }, [ref]);
}
