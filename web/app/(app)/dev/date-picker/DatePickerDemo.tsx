"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import {
  BSCalendar,
  BSDate,
  BSDateRangePicker,
  BSDateText,
  BSDateTimePicker,
  BSDateTimeText,
  DateLangToggle,
  useDateLang,
} from "@/components/date";
import { bsToAd, fiscalYear, formatDateBoth, rangeFor, relativeLabel, todayBs, type BsRange } from "@/lib/bs";

export function DatePickerDemo() {
  const [lang] = useDateLang();
  const [date, setDate] = useState<string | null>(todayBs());
  const [past, setPast] = useState<string | null>(null);
  const [range, setRange] = useState<BsRange>(rangeFor("this_month"));
  const [when, setWhen] = useState<string | null>(new Date().toISOString());
  const [grid, setGrid] = useState<string | null>(todayBs());

  return (
    <>
      <PageHeader title="Date picker demo" meta={<DateLangToggle />} />
      <div style={{ display: "grid", gap: 20, maxWidth: 760 }}>
        <section className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>&lt;BSDate&gt; – editable</h2>
          <BSDate label="Any date" value={date} onChange={(bs) => setDate(bs)} />
          <BSDate label="No future days, from Baisakh 2083" value={past} noFutureDays min="2083-01-01" onChange={(bs) => setPast(bs)} />
          <BSDate label="Small" size="sm" value={date} onChange={(bs) => setDate(bs)} />
          <p style={{ margin: 0, fontSize: 13, color: "var(--color-muted)" }}>
            Value: {date ?? "—"} · AD {date ? bsToAd(date) : "—"} · {date ? formatDateBoth(date, lang) : ""} · fiscal year{" "}
            {date ? fiscalYear(date).label : ""} · {date ? relativeLabel(bsToAd(date), lang) ?? "" : ""}
          </p>
        </section>
        <section className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>&lt;BSDateText&gt; – read only</h2>
          <BSDateText value={date} />
          <BSDateText value={date} weekday />
          <BSDateText value={date} inline />
          <BSDateText value={date} adFormat={null} />
          <BSDateText value={null} />
          <BSDateTimeText value={when} />
          <BSDateTimeText value={when} inline />
        </section>
        <section className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>&lt;BSDateRangePicker&gt;</h2>
          <BSDateRangePicker value={range} onChange={(r) => setRange(r)} />
          <p style={{ margin: 0, fontSize: 13, color: "var(--color-muted)" }}>
            {range.from} → {range.to}
          </p>
        </section>
        <section className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>&lt;BSDateTimePicker&gt;</h2>
          <BSDateTimePicker value={when} onChange={setWhen} />
          <p style={{ margin: 0, fontSize: 13, color: "var(--color-muted)" }}>UTC: {when}</p>
        </section>
        <section className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>&lt;BSCalendar&gt; – inline grid</h2>
          <div style={{ maxWidth: 340 }}>
            <BSCalendar value={grid} onSelect={setGrid} lang={lang} autoFocus={false} />
          </div>
        </section>
      </div>
    </>
  );
}
