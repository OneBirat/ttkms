"use client";

import { useBranch, withBranch } from "@/lib/branchContext";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { errorMessage } from "@/lib/api";
import { AdminGate } from "../components/AdminGate";
import { Select } from "../components/Field";
import { Toast, useToast } from "../components/Toast";
import { useLoader } from "../components/useLoader";
import { barcodePdfUrl, loadBarcodes } from "../barcodesApi";
import { code128 } from "../code128";
import type { BarcodeEmployee, StickerSize } from "../types";
import styles from "../components/admin.module.css";

const SUBTITLE =
  "Print barcode stickers for staff. Scanning a sticker on Mark attendance marks them present or overtime. Admin only.";

type Sort = "name" | "dept" | "id";

const BAR_HEIGHT: Record<string, number> = { "3x8": 34, "2x5": 56, "4x10": 26 };

/** Print only the sticker sheet: hide the sidebar and the page padding. */
const PRINT_CSS = `@media print {
  nav[aria-label="Main"] { display: none !important; }
  main { padding: 0 !important; }
  body { background: #fff; }
}`;

export function BarcodesPage() {
  return (
    <AdminGate page="barcodes" title="Employee barcodes" subtitle={SUBTITLE}>
      {() => <BarcodesScreen />}
    </AdminGate>
  );
}

export function sortEmployees(list: BarcodeEmployee[], sort: Sort, depts: string[]) {
  const copy = [...list];
  copy.sort((a, b) => {
    if (sort === "id") return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
    if (sort === "dept") {
      const da = depts.indexOf(a.department ?? "");
      const db = depts.indexOf(b.department ?? "");
      if (da !== db) return da - db;
    }
    return a.full_name.localeCompare(b.full_name);
  });
  return copy;
}

function Sticker({ employee, height }: { employee: BarcodeEmployee; height: number }) {
  const code = code128(employee.barcode);
  return (
    <div className={styles.sticker}>
      <svg
        role="img"
        aria-label={`Barcode ${employee.barcode} ${employee.full_name}`}
        height={height}
        viewBox={`0 0 ${code.width} 50`}
        preserveAspectRatio="none"
        shapeRendering="crispEdges"
      >
        {code.bars.map((bar) => (
          <rect key={bar.x} x={bar.x} y="0" width={bar.width} height="50" fill="#17222A" />
        ))}
      </svg>
      <span className={styles.stickerCode}>{employee.barcode}</span>
      <span className={styles.stickerName}>{employee.full_name}</span>
    </div>
  );
}

function BarcodesScreen() {
  // Stickers for the ONE active branch (the server lists and prints only its staff).
  const { branch } = useBranch();
  const data = useLoader(loadBarcodes);
  const { toast, show, dismiss } = useToast();
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("all");
  const [sort, setSort] = useState<Sort>("name");
  const [sizeKey, setSizeKey] = useState("3x8");
  /** Employees unticked by the admin (everyone is selected by default). */
  const [off, setOff] = useState<Set<number>>(() => new Set());

  const employees = useMemo(() => data.data?.employees ?? [], [data.data]);
  const sizes = data.data?.sizes ?? [];
  const size: StickerSize = sizes.find((s) => s.key === sizeKey) ??
    sizes[0] ?? { key: "3x8", label: "3 × 8 · 24 per page", columns: 3, rows: 8, per_page: 24 };

  const depts = useMemo(() => {
    const seen = new Map<string, number>();
    for (const e of employees) {
      const name = e.department ?? "No department";
      seen.set(name, (seen.get(name) ?? 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [employees]);

  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = employees.filter((e) => {
      if (dept !== "all" && (e.department ?? "No department") !== dept) return false;
      const hay = `${e.full_name} ${e.code}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    return sortEmployees(filtered, sort, depts.map(([name]) => name));
  }, [employees, q, dept, sort, depts]);

  const selected = list.filter((e) => !off.has(e.id));
  const allOn = list.length > 0 && selected.length === list.length;
  const pages = Math.max(1, Math.ceil(selected.length / size.per_page));
  const barHeight = BAR_HEIGHT[size.key] ?? 34;

  const toggleAll = () => {
    setOff((current) => {
      const next = new Set(current);
      for (const e of list) {
        if (allOn) next.add(e.id);
        else next.delete(e.id);
      }
      return next;
    });
  };

  const toggleOne = (id: number) => {
    setOff((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const print = () => {
    if (selected.length === 0) return;
    window.print();
  };

  const download = async () => {
    if (selected.length === 0) return;
    const url = barcodePdfUrl(
      selected.map((e) => e.id),
      size.key,
    );
    try {
      const response = await fetch(url, { credentials: "same-origin" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(body?.detail ?? `Download failed (${response.status})`);
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = "ttk-barcodes.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch (err) {
      show(errorMessage(err), "danger");
    }
  };

  return (
    <div className={styles.stack}>
      <style>{PRINT_CSS}</style>
      <div className={styles.noPrint}>
        <PageHeader
          title={withBranch("Employee barcodes", branch)}
          subtitle={SUBTITLE}
          actions={
            <>
              <button
                type="button"
                className="btn"
                onClick={() => void download()}
                aria-disabled={selected.length === 0}
                title={
                  data.data && !data.data.pdf_available
                    ? "The server cannot render PDFs yet (WeasyPrint needs pango); use Print."
                    : undefined
                }
              >
                Download PDF
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={print}
                aria-disabled={selected.length === 0}
              >
                Print {selected.length} sticker{selected.length === 1 ? "" : "s"}
              </button>
            </>
          }
        />
      </div>

      {data.error ? (
        <EmptyState icon="alert" title="Could not load employees" text={errorMessage(data.error)}>
          <button type="button" className="btn" onClick={data.reload}>
            Try again
          </button>
        </EmptyState>
      ) : (
        <>
          <section className={`card ${styles.bcFilters} ${styles.noPrint}`} aria-label="Filters">
            <div className={`${styles.bcFilter} ${styles.bcFilterSearch}`}>
              <label htmlFor="bc-q" className={styles.fieldLabel}>
                Search
              </label>
              <input
                id="bc-q"
                className="input"
                type="search"
                placeholder="Name or ID"
                value={q}
                onChange={(event) => setQ(event.target.value)}
              />
            </div>
            <div className={styles.bcFilter}>
              <label htmlFor="bc-dept" className={styles.fieldLabel}>
                Department
              </label>
              <Select id="bc-dept" value={dept} onChange={(event) => setDept(event.target.value)}>
                <option value="all">All departments ({employees.length})</option>
                {depts.map(([name, count]) => (
                  <option key={name} value={name}>
                    {name} ({count})
                  </option>
                ))}
              </Select>
            </div>
            <div className={styles.bcFilter}>
              <label htmlFor="bc-sort" className={styles.fieldLabel}>
                Sort
              </label>
              <Select id="bc-sort" value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
                <option value="name">Name A–Z</option>
                <option value="dept">Department</option>
                <option value="id">Employee ID</option>
              </Select>
            </div>
            <div className={styles.bcFilter}>
              <label htmlFor="bc-size" className={styles.fieldLabel}>
                Sticker size
              </label>
              <Select id="bc-size" value={size.key} onChange={(event) => setSizeKey(event.target.value)}>
                {sizes.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
          </section>

          <div className={styles.bcLayout}>
            <section className={`card ${styles.bcList} ${styles.noPrint}`} aria-label="Employees">
              <div className={styles.bcListHead}>
                <label className={styles.bcSelectAll}>
                  <input type="checkbox" checked={allOn} onChange={toggleAll} />
                  Select all · {list.length}
                </label>
                <span className="muted" style={{ fontSize: 13 }}>
                  {selected.length} selected
                </span>
              </div>
              <div className={styles.bcScroll}>
                {data.loading ? (
                  <p className={styles.noMatch} style={{ padding: 8 }} role="status">
                    Loading employees…
                  </p>
                ) : null}
                {list.map((e) => (
                  <label key={e.id} className={styles.bcRow}>
                    <input type="checkbox" checked={!off.has(e.id)} onChange={() => toggleOne(e.id)} />
                    <span className={styles.bcRowText}>
                      <span className={styles.bcRowName}>{e.full_name}</span>
                      <span className={styles.bcRowSub}>
                        {e.code} · {e.department ?? "No department"}
                        {e.designation ? ` · ${e.designation}` : ""}
                      </span>
                    </span>
                  </label>
                ))}
                {!data.loading && list.length === 0 ? (
                  <p className={styles.noMatch} style={{ padding: 8 }}>
                    No employees match.
                  </p>
                ) : null}
              </div>
            </section>

            <section className={styles.bcPreview} aria-label="Print preview">
              <div className={`${styles.bcPreviewHead} ${styles.noPrint}`}>
                <h2 className={styles.bcPreviewTitle}>Print preview · A4</h2>
                <span className="muted" style={{ fontSize: 13 }}>
                  {size.label} · {pages} page{pages === 1 ? "" : "s"}
                </span>
              </div>
              <div className={styles.bcPaper}>
                <div
                  className={styles.a4}
                  style={{ gridTemplateColumns: `repeat(${size.columns}, minmax(0, 1fr))` }}
                >
                  {selected.map((e, index) => (
                    <div
                      key={e.id}
                      className={index >= size.per_page ? styles.beyondPage : undefined}
                      style={{ display: index >= size.per_page ? undefined : "contents" }}
                    >
                      <Sticker employee={e} height={barHeight} />
                    </div>
                  ))}
                  {selected.length === 0 ? (
                    <p className={styles.sheetEmpty}>
                      Select employees on the left to preview their stickers.
                    </p>
                  ) : null}
                </div>
              </div>
            </section>
          </div>
        </>
      )}
      <Toast toast={toast} onDismiss={dismiss} />
    </div>
  );
}
