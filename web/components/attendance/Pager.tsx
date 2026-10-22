"use client";

import styles from "./shared.module.css";

export interface PagerProps {
  page: number;
  pages: number;
  onPage: (page: number) => void;
  /** Text between/next to the buttons, e.g. "Page 1 of 3 · 27 shown". */
  label?: string;
  /** Show numbered page buttons (report) instead of just ‹ label ›. */
  numbered?: boolean;
  perPage?: number;
  perPageOptions?: number[];
  onPerPage?: (perPage: number) => void;
}

/** Window of page numbers around the current page (max 7). */
export function pageWindow(page: number, pages: number, size = 7): number[] {
  if (pages <= size) return Array.from({ length: pages }, (_, i) => i + 1);
  const half = Math.floor(size / 2);
  const start = Math.min(Math.max(1, page - half), pages - size + 1);
  return Array.from({ length: size }, (_, i) => start + i);
}

export function Pager({
  page,
  pages,
  onPage,
  label,
  numbered = false,
  perPage,
  perPageOptions = [25, 50, 100],
  onPerPage,
}: PagerProps) {
  const prev = () => onPage(Math.max(1, page - 1));
  const next = () => onPage(Math.min(pages, page + 1));
  return (
    <nav className={styles.pager} aria-label="Pagination">
      <div className={styles.pagerButtons}>
        <button
          type="button"
          className={styles.pagerBtn}
          aria-label="Previous page"
          onClick={prev}
          disabled={page <= 1}
        >
          ‹
        </button>
        {numbered ? (
          pageWindow(page, pages).map((n) => (
            <button
              key={n}
              type="button"
              className={styles.pagerBtn}
              aria-current={n === page ? "page" : undefined}
              aria-label={`Page ${n}`}
              onClick={() => onPage(n)}
            >
              {n}
            </button>
          ))
        ) : (
          <span className={styles.pagerLabel}>
            Page {page} of {pages}
          </span>
        )}
        <button
          type="button"
          className={styles.pagerBtn}
          aria-label="Next page"
          onClick={next}
          disabled={page >= pages}
        >
          ›
        </button>
      </div>
      {label ? <span>{label}</span> : null}
      {perPage !== undefined && onPerPage ? (
        <label className={styles.perPage}>
          <span>Per page</span>
          <select value={perPage} onChange={(e) => onPerPage(Number(e.target.value))}>
            {perPageOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </nav>
  );
}
