"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BSDate } from "@/components/date";
import { Icon } from "@/components/icons";
import { ApiError } from "@/lib/api";
import { useActiveBranch } from "@/lib/branchContext";
import { adToBs, adToBsIso, bsMonthRange, formatAdRange, formatBs, monthLabel, monthOf, shiftMonth, WEEKDAYS_SHORT_EN, type BsMonth } from "@/lib/bs";
import { useSession } from "@/lib/session";
import { createHoliday, deleteHoliday, listHolidays, updateHoliday } from "../api";
import type { Holiday, HolidayList } from "../types";
import { EMPTY_FORM, HOLIDAY_NAME_MAX, bodyOf, calendarCells, formErrors, formOf, monthCounts, scopeText, weekdayAndAd, type HolidayCell, type HolidayForm } from "./model";
import styles from "./holidays.module.css";

type FieldErrors = Partial<Record<"date" | "name" | "branch_ids" | "form", string>>;

/**
 * Holiday calendar (/holidays, opened from the Dashboard; super admin only - everyone else is
 * sent back to the Dashboard). One BS month per view; click today or an upcoming day to mark it
 * as a public holiday, click an upcoming holiday to edit or delete it. Past days are locked.
 * "Today" is the server's Kathmandu day (the list answer carries it).
 */
export function HolidayPage() {
  const router = useRouter();
  const { user } = useSession();
  const { branches } = useActiveBranch();
  const allowed = Boolean(user?.is_super_admin);

  useEffect(() => {
    if (user && !user.is_super_admin) router.replace("/");
  }, [user, router]);

  const [view, setView] = useState<BsMonth | null>(null);
  const [data, setData] = useState<HolidayList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<HolidayForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // The month on screen; before the first answer, a fetch of "around now" tells us today.
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    const range = view ? bsMonthRange(view.year, view.month) : null;
    // Without a month yet, ask for a wide window just to learn the server's today.
    const from = range?.start ?? "2000-01-01";
    const to = range?.end ?? "2000-01-01";
    listHolidays(from, to)
      .then((list) => {
        if (cancelled) return;
        setLoadError(null);
        if (!view) {
          const bs = adToBs(list.today);
          setView({ year: bs.year, month: bs.month });
        } else {
          setData(list);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load the holidays.");
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, view, reloadKey]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  const today = data?.today ?? null;
  const holidays = useMemo(() => data?.holidays ?? [], [data]);
  const cells = useMemo(() => (view && today ? calendarCells(view.year, view.month, holidays, today) : []), [view, today, holidays]);
  const counts = view ? monthCounts(view.year, view.month, holidays) : null;
  const editing = form.id !== null;

  const patch = useCallback((changes: Partial<HolidayForm>) => {
    setForm((f) => ({ ...f, ...changes }));
    setErrors({});
  }, []);
  const reset = () => {
    setForm(EMPTY_FORM);
    setErrors({});
  };

  const pick = (cell: HolidayCell) => {
    if (cell.past || cell.trailing) return;
    setErrors({});
    setForm(cell.holiday ? formOf(cell.holiday) : { ...EMPTY_FORM, date_bs: cell.bs });
  };
  const edit = (holiday: Holiday) => {
    setErrors({});
    setForm(formOf(holiday));
  };

  const save = async () => {
    if (!today || busy) return;
    const found = formErrors(form, today);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setBusy(true);
    try {
      const saved = editing ? await updateHoliday(form.id!, bodyOf(form)) : await createHoliday(bodyOf(form));
      setNotice(`${saved.name} saved for ${formatBs(saved.date_bs)}.`);
      reset();
      // Show the month of the saved holiday, and refetch it.
      const month = monthOf(saved.date_bs);
      if (month && view && (month.year !== view.year || month.month !== view.month)) setView(month);
      else setReloadKey((k) => k + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save the holiday.";
      const field = err instanceof ApiError && (err.field === "date" || err.field === "name" || err.field === "branch_ids") ? err.field : "form";
      setErrors({ [field]: message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editing || busy) return;
    if (!window.confirm(`Delete the holiday "${form.name}"? Staff will have to be marked on that day again.`)) return;
    setBusy(true);
    try {
      await deleteHoliday(form.id!);
      setNotice("Holiday deleted.");
      reset();
      setReloadKey((k) => k + 1);
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : "Could not delete the holiday." });
    } finally {
      setBusy(false);
    }
  };

  if (!allowed) {
    return (
      <p className="muted" role="status">
        {user ? "Only the super admin can open the holiday calendar. Taking you back to the dashboard…" : "Loading…"}
      </p>
    );
  }

  const range = view ? bsMonthRange(view.year, view.month) : null;
  const todayBs = today ? adToBsIso(today) : null;
  const dateAd = form.date_bs ? bodyOf(form).date : null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headText}>
          <Link href="/" className={styles.back}>
            ‹ Back to dashboard
          </Link>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>Holiday calendar</h1>
            <span className={styles.badge}>Super admin only</span>
          </div>
          <p className={styles.subtitle}>Click today or an upcoming day to mark it as a public holiday. Past days are locked.</p>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            reset();
            document.getElementById("holiday-name")?.focus();
          }}
        >
          <Icon name="plus" size={16} />
          Add holiday
        </button>
      </header>

      {loadError ? (
        <p role="alert" className={styles.error}>
          {loadError}{" "}
          <button type="button" className="btn btn--sm" onClick={() => setReloadKey((k) => k + 1)}>
            Try again
          </button>
        </p>
      ) : null}

      <div className={styles.layout}>
        <section className={`card ${styles.calendar}`} aria-label="Calendar">
          <div className={styles.toolbar}>
            <div className={styles.nav}>
              <button type="button" className={styles.navBtn} aria-label="Previous month" disabled={!view} onClick={() => view && setView(shiftMonth(view.year, view.month, -1))}>
                ‹
              </button>
              <div className={styles.monthTitle}>
                <span className={styles.monthName}>{view ? monthLabel(view.year, view.month) : "…"}</span>
                <span className={styles.monthAd}>{range ? formatAdRange(range.start, range.end) : ""}</span>
              </div>
              <button type="button" className={styles.navBtn} aria-label="Next month" disabled={!view} onClick={() => view && setView(shiftMonth(view.year, view.month, 1))}>
                ›
              </button>
              <button
                type="button"
                className="btn btn--sm"
                disabled={!today}
                onClick={() => {
                  if (!today) return;
                  const bs = adToBs(today);
                  setView({ year: bs.year, month: bs.month });
                }}
              >
                Today
              </button>
            </div>
            <div className={styles.chips} aria-label="This month">
              <span className={styles.chip} data-kind="holiday">
                Public holidays <b>{counts?.holidays ?? 0}</b>
              </span>
              <span className={styles.chip} data-kind="off">
                Weekly off <b>{counts?.weeklyOff ?? 0}</b>
              </span>
              <span className={styles.chip}>
                Working days <b>{counts?.working ?? 0}</b>
              </span>
            </div>
          </div>

          <div className={styles.gridScroll}>
            <div className={styles.grid} role="grid" aria-label={view ? monthLabel(view.year, view.month) : "Month"}>
              {WEEKDAYS_SHORT_EN.map((name, i) => (
                <div key={name} role="columnheader" className={styles.weekday} data-off={i === 6 || undefined}>
                  {name}
                </div>
              ))}
              {cells.map((cell, i) =>
                cell === null ? (
                  <div key={`blank-${i}`} className={styles.blank} role="gridcell" />
                ) : (
                  <button
                    key={cell.bs}
                    type="button"
                    role="gridcell"
                    className={styles.cell}
                    disabled={cell.past || cell.trailing}
                    data-holiday={cell.holiday ? "true" : undefined}
                    data-off={!cell.holiday && cell.weeklyOff ? "true" : undefined}
                    data-today={cell.isToday || undefined}
                    data-past={cell.past || undefined}
                    data-trailing={cell.trailing || undefined}
                    aria-selected={!cell.trailing && form.date_bs === cell.bs}
                    aria-label={`${formatBs(cell.bs)}, ${cell.adLabel}${cell.holiday ? `, public holiday: ${cell.holiday.name}` : cell.weeklyOff ? ", weekly off" : ""}${cell.past ? ", locked" : ""}`}
                    onClick={() => pick(cell)}
                  >
                    <span className={styles.cellTop}>
                      <span className={styles.bsDay}>{cell.bsDay}</span>
                      <span className={styles.adDay}>{cell.adLabel}</span>
                    </span>
                    {cell.holiday ? (
                      <span className={styles.nameChip} title={cell.holiday.name}>
                        {cell.holiday.name}
                      </span>
                    ) : cell.weeklyOff && !cell.trailing ? (
                      <span className={styles.offText}>Weekly off</span>
                    ) : null}
                    {cell.isToday ? <span className={styles.todayText}>Today</span> : null}
                  </button>
                ),
              )}
            </div>
          </div>

          <div className={styles.legend} aria-label="Legend">
            <span className={styles.legendItem}>
              <span className={styles.swatch} data-kind="holiday" /> Public holiday
            </span>
            <span className={styles.legendItem}>
              <span className={styles.swatch} data-kind="off" /> Weekly off
            </span>
            <span className={styles.legendItem}>
              <span className={styles.swatch} data-kind="today" /> Today
            </span>
            <span className={styles.legendItem}>
              <span className={styles.swatch} data-kind="selected" /> Selected
            </span>
            <span className={styles.legendItem}>
              <span className={styles.swatch} data-kind="past" /> Past (locked)
            </span>
          </div>
        </section>

        <div className={styles.side}>
          <section className={`card ${styles.form}`} aria-labelledby="holiday-form-h">
            <h2 id="holiday-form-h" className={styles.cardTitle}>
              {editing ? "Edit holiday" : "Mark holiday"}
            </h2>

            <div className={styles.field}>
              <span className={styles.label}>Date</span>
              <BSDate
                value={form.date_bs || null}
                onChange={(bs) => patch({ date_bs: bs })}
                min={todayBs}
                adFormat={null}
                placeholder="Pick a date"
                invalid={Boolean(errors.date)}
                block
              />
              {dateAd ? <span className={styles.hint}>{weekdayAndAd(dateAd)}</span> : null}
              {errors.date ? (
                <span role="alert" className={styles.fieldError}>
                  {errors.date}
                </span>
              ) : null}
            </div>

            <div className={styles.field}>
              <label htmlFor="holiday-name" className={styles.label}>
                Holiday name
              </label>
              <div className="field">
                <input
                  id="holiday-name"
                  type="text"
                  maxLength={HOLIDAY_NAME_MAX}
                  value={form.name}
                  placeholder="e.g. Tihar"
                  aria-invalid={errors.name ? true : undefined}
                  onChange={(event) => patch({ name: event.target.value })}
                  autoComplete="off"
                />
              </div>
              {errors.name ? (
                <span role="alert" className={styles.fieldError}>
                  {errors.name}
                </span>
              ) : null}
            </div>

            <fieldset className={styles.fieldset}>
              <legend className={styles.label}>Applies to</legend>
              <label className={styles.radio}>
                <input type="radio" name="holiday-scope" checked={form.all_branches} onChange={() => patch({ all_branches: true })} />
                All branches
              </label>
              <label className={styles.radio}>
                <input type="radio" name="holiday-scope" checked={!form.all_branches} onChange={() => patch({ all_branches: false })} />
                Selected branches only
              </label>
              {!form.all_branches ? (
                <div className={styles.branchList} role="group" aria-label="Branches">
                  {branches.length === 0 ? <span className={styles.hint}>No branches to choose from.</span> : null}
                  {branches.map((b) => (
                    <label key={b.id} className={styles.check}>
                      <input
                        type="checkbox"
                        checked={form.branch_ids.includes(b.id)}
                        onChange={(event) =>
                          patch({ branch_ids: event.target.checked ? [...form.branch_ids, b.id] : form.branch_ids.filter((id) => id !== b.id) })
                        }
                      />
                      {b.name}
                    </label>
                  ))}
                </div>
              ) : null}
              {errors.branch_ids ? (
                <span role="alert" className={styles.fieldError}>
                  {errors.branch_ids}
                </span>
              ) : null}
            </fieldset>

            <div className={styles.field}>
              <label className={styles.check}>
                <input type="checkbox" checked={form.is_paid} onChange={(event) => patch({ is_paid: event.target.checked })} />
                Paid holiday
              </label>
              <span className={styles.hint}>
                {form.is_paid ? "Staff are not counted absent and no salary is cut." : "Staff are not counted absent, but the day is not paid."}
              </span>
            </div>

            {errors.form ? (
              <p role="alert" className={styles.fieldError}>
                {errors.form}
              </p>
            ) : null}

            <div className={styles.actions}>
              <button type="button" className="btn btn--primary" disabled={busy || !today} onClick={() => void save()}>
                {busy ? "Saving…" : "Save holiday"}
              </button>
              <button type="button" className="btn" disabled={busy} onClick={reset}>
                Cancel
              </button>
              {editing ? (
                <button type="button" className={`btn ${styles.delete}`} disabled={busy} onClick={() => void remove()}>
                  Delete
                </button>
              ) : null}
            </div>
          </section>

          <section className={`card ${styles.list}`} aria-labelledby="holiday-list-h">
            <h2 id="holiday-list-h" className={styles.cardTitle}>
              Holidays in {view ? monthLabel(view.year, view.month) : "this month"}
            </h2>
            {holidays.length === 0 ? <p className={styles.empty}>No public holiday this month.</p> : null}
            <ul className={styles.items}>
              {holidays.map((h) => (
                <li key={h.id} className={styles.item}>
                  <span className={styles.itemText}>
                    <span className={styles.itemName}>
                      {h.name}
                      {h.is_paid ? "" : " · unpaid"}
                    </span>
                    <span className={styles.itemMeta}>
                      {formatBs(h.date_bs)} · {weekdayAndAd(h.date)}
                    </span>
                    <span className={styles.itemMeta}>{scopeText(h)}</span>
                  </span>
                  {h.locked ? (
                    <span className={styles.locked}>Locked</span>
                  ) : (
                    <button type="button" className="btn btn--sm" onClick={() => edit(h)}>
                      Edit
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      {notice ? (
        <div role="status" className={styles.notice}>
          {notice}
        </div>
      ) : null}
    </div>
  );
}
