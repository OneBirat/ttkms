import Link from "next/link";
import styles from "./Pagination.module.css";

export interface PaginationProps {
  page: number;
  pages: number;
  hrefFor: (page: number) => string;
  /** Left-hand summary, e.g. "Showing 6 of 29 variations". */
  summary?: string;
}

/** Page numbers to show around the current page (at most 5). */
export function pageWindow(current: number, total: number): number[] {
  const size = Math.min(5, total);
  let start = Math.max(1, current - Math.floor(size / 2));
  start = Math.min(start, total - size + 1);
  return Array.from({ length: size }, (_, i) => start + i);
}

/** Pager from the design: summary on the left, ‹ 1 2 3 › buttons on the right. */
export function Pagination({ page, pages, hrefFor, summary }: PaginationProps) {
  const total = Math.max(pages, 1);
  const current = Math.min(Math.max(page, 1), total);
  const hasPrev = current > 1;
  const hasNext = current < total;

  return (
    <nav className={styles.pagination} aria-label="Pagination">
      <span>{summary ?? `Page ${current} of ${total}`}</span>
      <div className={styles.pages}>
        {hasPrev ? (
          <Link
            href={hrefFor(current - 1)}
            rel="prev"
            className={styles.button}
            aria-label="Previous page"
          >
            ‹
          </Link>
        ) : (
          <span className={styles.button} aria-disabled="true" aria-label="Previous page">
            ‹
          </span>
        )}
        {pageWindow(current, total).map((n) =>
          n === current ? (
            <span key={n} className={styles.button} aria-current="page">
              {n}
            </span>
          ) : (
            <Link key={n} href={hrefFor(n)} className={styles.button}>
              {n}
            </Link>
          ),
        )}
        {hasNext ? (
          <Link
            href={hrefFor(current + 1)}
            rel="next"
            className={styles.button}
            aria-label="Next page"
          >
            ›
          </Link>
        ) : (
          <span className={styles.button} aria-disabled="true" aria-label="Next page">
            ›
          </span>
        )}
      </div>
    </nav>
  );
}
