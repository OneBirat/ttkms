import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BSCalendar } from "../BSCalendar";
import { BSDate, BSDateText } from "../BSDate";
import { BSDateRangePicker } from "../BSDateRangePicker";
import { BSDateTimeText, formatTime12 } from "../BSDateTimePicker";
import { effectiveBounds, initialMonth, monthGrid, moveDate, todayParts, weekEdge, yearOptions } from "../pickerModel";

const NOW = "2026-10-24T10:00:00Z"; // Kartik 7, 2083 (Saturday)

describe("picker model", () => {
  it("builds the grid of a month with today, Saturdays and limits", () => {
    const today = todayParts(NOW);
    assert.equal(today.bs, "2083-07-07");
    const bounds = effectiveBounds({ noFutureDays: true }, today.bs);
    assert.equal(bounds.max, "2083-07-07");
    const { lead, cells } = monthGrid({ year: 2083, month: 7 }, bounds, today.bs);
    assert.equal(cells.length, 30);
    assert.equal(lead, 0); // Kartik 1, 2083 = Sun 18 Oct 2026
    assert.equal(cells[0].ad, "2026-10-18");
    assert.deepEqual(cells.filter((c) => c.isSaturday).map((c) => c.day), [7, 14, 21, 28]);
    assert.ok(cells[6].isToday && !cells[6].disabled && cells[7].disabled);
    assert.equal(cells.filter((c) => c.disabled).length, 23);
    const narrow = effectiveBounds({ min: "2083-07-03", max: "2083-07-05" }, today.bs);
    const g = monthGrid({ year: 2083, month: 7 }, narrow, today.bs);
    assert.deepEqual(g.cells.filter((c) => !c.disabled).map((c) => c.day), [3, 4, 5]);
    assert.deepEqual(yearOptions(narrow), [2083]);
  });
  it("opens on the value's month, clamped into the bounds", () => {
    const today = todayParts(NOW);
    const bounds = effectiveBounds({}, today.bs);
    assert.deepEqual(initialMonth("2082-03-15", today.parts, bounds), { year: 2082, month: 3 });
    assert.deepEqual(initialMonth(null, today.parts, bounds), { year: 2083, month: 7 });
    assert.deepEqual(initialMonth("2083-07-07", today.parts, effectiveBounds({ max: "2083-05-10" }, today.bs)), { year: 2083, month: 5 });
  });
  it("keyboard moves stay on real dates", () => {
    assert.equal(moveDate("2083-07-01", "day", -1), "2083-06-31");
    assert.equal(moveDate("2083-07-07", "week", 1), "2083-07-14");
    assert.equal(moveDate("2083-06-31", "month", 1), "2083-07-30"); // Kartik has 30 days
    assert.equal(moveDate("2083-07-07", "year", -1), "2082-07-07");
    assert.equal(weekEdge("2083-07-07", "start"), "2083-07-01"); // Saturday -> Sunday of that week
    assert.equal(weekEdge("2083-07-01", "end"), "2083-07-07");
  });
});

describe("<BSCalendar>", () => {
  it("renders an ARIA grid with the BS day, the AD day, Saturday red and today ringed", () => {
    const html = renderToStaticMarkup(createElement(BSCalendar, { value: "2083-07-03", onSelect: () => {}, now: NOW, noFutureDays: true }));
    assert.match(html, /role="grid" aria-label="Kartik 2083"/);
    assert.equal((html.match(/role="gridcell"/g) ?? []).length, 30);
    assert.match(html, /data-bs="2083-07-07"[^>]*data-today="true"[^>]*data-sat="true"/);
    assert.match(html, /data-bs="2083-07-03"[^>]*data-sel="true"/);
    assert.match(html, /aria-selected="true"[^>]*aria-label="Tuesday, Kartik 3, 2083 · 20 Oct 2026"/);
    assert.match(html, /disabled=""[^>]*data-bs="2083-07-08"/); // tomorrow locked
    assert.match(html, />1 Nov</); // AD month change shown in the cell
    assert.match(html, /Tue 20 Oct 2026/);
    assert.match(html, /आज<\/span> \/ Today/);
    assert.ok(html.includes("<option") && html.includes(">Kartik</option>"));
  });
  it("switches to Nepali names and digits", () => {
    const html = renderToStaticMarkup(createElement(BSCalendar, { value: "2083-07-03", onSelect: () => {}, now: NOW, lang: "ne" }));
    assert.match(html, /aria-label="मंगलबार, कार्तिक ३, २०८३ · 20 Oct 2026"/);
    assert.match(html, />कार्तिक<\/option>/);
    assert.match(html, />२०८३<\/option>/);
    assert.match(html, /Kartik 2083 · Oct 2026 – Nov 2026/);
  });
});

describe("<BSDate> and friends", () => {
  it("shows BS first and AD small; editable form has a button and a hidden input", () => {
    const text = renderToStaticMarkup(createElement(BSDateText, { value: "2083-07-07" }));
    assert.match(text, /Kartik 7, 2083/);
    assert.match(text, /24 Oct 2026/);
    assert.ok(text.indexOf("Kartik 7, 2083") < text.indexOf("24 Oct 2026"));
    const editable = renderToStaticMarkup(createElement(BSDate, { value: "2083-07-07", name: "date_bs", label: "Date", onChange: () => {} }));
    assert.match(editable, /<button type="button"[^>]*aria-haspopup="dialog"/);
    assert.match(editable, /<input type="hidden" name="date_bs" value="2083-07-07"/);
    assert.match(editable, /<label[^>]*>Date<\/label>/);
    const empty = renderToStaticMarkup(createElement(BSDateText, { value: null }));
    assert.match(empty, /No date/);
  });
  it("range picker marks the active preset", () => {
    const html = renderToStaticMarkup(
      createElement(BSDateRangePicker, { value: { from: "2083-07-01", to: "2083-07-07" }, onChange: () => {}, now: NOW }),
    );
    assert.match(html, /aria-pressed="true"[^>]*>This month</);
    assert.match(html, /aria-pressed="false"[^>]*>Last month</);
  });
  it("timestamps show the Nepal wall-clock time", () => {
    assert.equal(formatTime12("2026-10-23T03:29:00Z"), "9:14 AM");
    assert.equal(formatTime12("2026-10-23T12:29:00Z"), "6:14 PM");
    assert.equal(formatTime12("2026-10-23T18:15:00Z"), "12:00 AM");
    assert.equal(formatTime12("2026-10-23T03:29:00Z", "ne"), "९:१४ AM");
    const html = renderToStaticMarkup(createElement(BSDateTimeText, { value: "2026-10-23T03:29:00Z" }));
    assert.match(html, /Kartik 6, 2083 · 9:14 AM/);
    assert.match(html, /23 Oct 2026/);
  });
});
