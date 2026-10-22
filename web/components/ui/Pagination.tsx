import Link from "next/link";
import { Icon } from "@/components/icons";
import styles from "./Pagination.module.css";

export interface PaginationProps {
  page: number;
  pages: number;
  hrefFor: (page: number) => string;
}

export function Pagination({ page, pages, hrefFor }: PaginationProps) {
  const total = Math.max(pages, 1);
  const current = Math.min(Math.max(page, 1), total);
  const hasPrev = current > 1;
  const hasNext = current < total;

  return (
    <nav className={styles.pagination} aria-label="Pagination">
      {hasPrev ? (
        <Link href={hrefFor(current - 1)} rel="prev" className="btn">
          <Icon name="chevron-left" />
          Previous
        </Link>
      ) : (
        <span className="btn" aria-disabled="true">
          <Icon name="chevron-left" />
          Previous
        </span>
      )}
      <span className={styles.status}>
        Page <span className="mono">{current}</span> of{" "}
        <span className="mono">{total}</span>
      </span>
      {hasNext ? (
        <Link href={hrefFor(current + 1)} rel="next" className="btn">
          Next
          <Icon name="chevron-right" />
        </Link>
      ) : (
        <span className="btn" aria-disabled="true">
          Next
          <Icon name="chevron-right" />
        </span>
      )}
    </nav>
  );
}
