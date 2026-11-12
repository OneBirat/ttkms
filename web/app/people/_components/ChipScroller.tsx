"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { moreToTheRight, wheelShift } from "../_lib/chipScroll";
import styles from "./report.module.css";

/**
 * Chips on ONE line that never wraps: the row scrolls sideways (trackpad, mouse wheel, touch,
 * or Tab to a chip), the scrollbar is hidden and a soft fade on the right edge says there is
 * more. Used by the Payment register's department chips.
 */
export function ChipScroller({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setMore(moreToTheRight(el));
    // Not passive: an up / down wheel over the row moves it sideways instead of the page.
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      const shift = wheelShift(el, event.deltaX, event.deltaY);
      if (shift === 0) return;
      event.preventDefault();
      el.scrollLeft += event.deltaMode === 1 ? shift * 40 : shift;
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    // The row's width and its chips (counts load later) both change what fits.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    for (const child of Array.from(el.children)) observer?.observe(child);
    return () => {
      el.removeEventListener("scroll", measure);
      el.removeEventListener("wheel", onWheel);
      observer?.disconnect();
    };
  }, [children]);

  return (
    <div className={styles.chipLine} data-more={more || undefined}>
      <div ref={ref} role="group" aria-label={label} className={styles.chipLineScroll}>
        {children}
      </div>
    </div>
  );
}
