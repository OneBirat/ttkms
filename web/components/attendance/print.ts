/**
 * Print-ready HTML for the attendance report (A4 landscape), matching
 * docs/design/ExportPdf.dc.html. The page opens it in a new window and calls
 * print(). TODO backend: same layout as a WeasyPrint template
 * (app/core/templates/print/attendance_report.html) served at
 * GET /api/attendance/report.pdf.
 */

import { formatRate, isLowPresence, statusCode, weekdayInitial } from "./helpers";
import type { ExportModel } from "./exportModel";
import type { DayStatus, ReportRow } from "./types";
import type { DepartmentGroup } from "./helpers";

const esc = (s: string | number) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const FILL: Record<DayStatus, string> = {
  present: "",
  late: "background:#D7ECE9",
  half_day: "background:#FBEBD0",
  leave: "background:#E1E7F3",
  absent: "background:#F6D9CF;font-weight:700",
  weekly_off: "background:#EEF0EC;color:#6B757B",
  not_marked: "color:#9AA3A9",
};

type Line = { kind: "head"; group: DepartmentGroup } | { kind: "row"; row: ReportRow };

/** Rows that fit on the first page (with summary boxes) and on later pages. */
export const PAGE_CAPACITY = { first: 20, rest: 27 };

export function paginateLines(lines: Line[], capacity = PAGE_CAPACITY): Line[][] {
  const pages: Line[][] = [];
  let i = 0;
  while (i < lines.length || pages.length === 0) {
    const size = pages.length === 0 ? capacity.first : capacity.rest;
    pages.push(lines.slice(i, i + size));
    i += size;
  }
  return pages;
}

function css(): string {
  return `
@page { size: A4 landscape; margin: 0; }
@font-face { font-family: "IBM Plex Sans"; font-weight: 400; src: url("/fonts/IBMPlexSans-Regular.woff2") format("woff2"); }
@font-face { font-family: "IBM Plex Sans"; font-weight: 500; src: url("/fonts/IBMPlexSans-Medium.woff2") format("woff2"); }
@font-face { font-family: "IBM Plex Sans"; font-weight: 600; src: url("/fonts/IBMPlexSans-SemiBold.woff2") format("woff2"); }
@font-face { font-family: "IBM Plex Sans"; font-weight: 700; src: url("/fonts/IBMPlexSans-SemiBold.woff2") format("woff2"); }
@font-face { font-family: "IBM Plex Mono"; font-weight: 500; src: url("/fonts/IBMPlexMono-Medium.woff2") format("woff2"); }
@font-face { font-family: "Noto Sans Devanagari"; font-weight: 500; src: url("/fonts/NotoSansDevanagari-Medium.woff2") format("woff2"); }
* { box-sizing: border-box; }
html, body { margin: 0; background: #E6E9E4; }
body { font-family: "IBM Plex Sans", system-ui, sans-serif; color: #1B2328; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 297mm; height: 210mm; margin: 0 auto; padding: 26px 26px 20px; background: #FFFFFF; display: flex; flex-direction: column; gap: 12px; page-break-after: always; overflow: hidden; }
.page:last-child { page-break-after: auto; }
@media screen { .page { margin: 16px auto; box-shadow: 0 2px 12px rgba(0,0,0,.15); } }
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; border-bottom: 2px solid #0E6B6B; padding-bottom: 10px; }
.brand { display: flex; align-items: center; gap: 12px; }
.tile { width: 34px; height: 34px; border-radius: 7px; background: #0E6B6B; color: #FFF; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; }
h1 { margin: 0; font-size: 18px; font-weight: 700; }
.sub { font-size: 11px; color: #4A555C; }
.meta { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; font-size: 10px; color: #4A555C; }
.np { font-family: "Noto Sans Devanagari", sans-serif; font-size: 11px; color: #1B2328; }
.boxes { display: flex; gap: 10px; }
.box { flex: 1; border: 1px solid #D5D9D5; border-radius: 6px; padding: 6px 10px; display: flex; flex-direction: column; }
.box span:first-child { font-size: 9px; color: #4A555C; text-transform: uppercase; letter-spacing: .05em; }
.box span:last-child { font-size: 15px; font-weight: 700; }
.box small { font-size: 11px; font-weight: 500; color: #4A555C; }
table { border-collapse: collapse; table-layout: fixed; width: 100%; font-size: 10px; }
th, td { border: 1px solid #D5D9D5; text-align: center; padding: 0; height: 19px; }
thead th { background: #F1F3F0; color: #3E4A52; font-weight: 600; height: 30px; line-height: 1.15; }
.nm { text-align: left; padding: 0 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
.wd { font-family: "Noto Sans Devanagari", sans-serif; font-size: 8px; font-weight: 500; }
.sat { color: #8E2F12; }
.tt { font-family: "IBM Plex Mono", monospace; font-size: 10px; }
.dept { background: #F7F8F6; font-weight: 700; font-size: 10px; }
.dept span { font-weight: 500; color: #4A555C; }
tfoot th, tfoot td { background: #F1F3F0; }
.low { color: #8E2F12; }
.off { background: #EEF0EC; color: #6B757B; }
footer { margin-top: auto; display: flex; justify-content: space-between; align-items: center; font-size: 9px; color: #4A555C; border-top: 1px solid #D5D9D5; padding-top: 6px; }
`;
}

function headerHtml(m: ExportModel): string {
  return `<header>
  <div class="brand"><div class="tile">TT</div>
    <div><h1>${esc(m.title)}</h1>
    <div class="sub">${esc(m.ad_range)} · ${esc(m.filter_label)} · ${m.summary.staff} staff · ${m.summary.working_days} working days</div></div>
  </div>
  <div class="meta"><span class="np">${esc(m.printed_at_np)}</span><span>Generated ${esc(m.printed_at_ad)} by ${esc(m.printed_by)}</span></div>
</header>`;
}

function boxesHtml(m: ExportModel): string {
  const s = m.summary;
  return `<div class="boxes">
  <div class="box"><span>Total staff</span><span>${s.staff}</span></div>
  <div class="box"><span>Present per day (avg)</span><span>${s.avg_present.toFixed(1)} <small>· ${formatRate(s.rate)}</small></span></div>
  <div class="box"><span>Total present days</span><span>${s.present_days}</span></div>
  <div class="box"><span>Late arrivals</span><span>${s.late}</span></div>
  <div class="box"><span>Absent · leave days</span><span>${s.absent} <small>· ${s.leave}</small></span></div>
</div>`;
}

function tableHtml(m: ExportModel, lines: Line[], withFooter: boolean): string {
  const days = m.month.days;
  const span = days.length + 7;
  const colgroup =
    `<colgroup><col style="width:132px">` +
    days.map(() => `<col style="width:25px">`).join("") +
    `<col style="width:26px">`.repeat(5) +
    `<col style="width:36px"></colgroup>`;
  const head =
    `<thead><tr><th class="nm">Employee</th>` +
    days
      .map(
        (d) =>
          `<th${d.is_weekly_off ? ' class="sat"' : ""}>${d.bs_day}<br><span class="wd">${weekdayInitial(d.weekday)}</span></th>`,
      )
      .join("") +
    `<th>P</th><th>L</th><th>H</th><th>V</th><th>A</th><th>Paid</th></tr></thead>`;
  const body = lines
    .map((line) => {
      if (line.kind === "head") {
        const g = line.group;
        return `<tr><th scope="rowgroup" colspan="${span}" class="nm dept">${esc(g.department_name)} <span>· ${g.rows.length} staff · ${formatRate(g.rate)} attendance</span></th></tr>`;
      }
      const r = line.row;
      const t = r.totals;
      return (
        `<tr><th scope="row" class="nm">${esc(r.employee.name)}</th>` +
        r.cells.map((c) => `<td style="${FILL[c.status]}">${statusCode(c.status)}</td>`).join("") +
        `<td class="tt">${t.present}</td><td class="tt">${t.late}</td><td class="tt">${t.half_day}</td>` +
        `<td class="tt">${t.leave}</td><td class="tt">${t.absent}</td><td class="tt" style="font-weight:700">${t.paid_days}</td></tr>`
      );
    })
    .join("");
  const foot = withFooter
    ? `<tfoot><tr><th class="nm" style="font-weight:700">Staff present (all ${m.summary.staff})</th>` +
      m.staff_present
        .map((n) =>
          n === null
            ? `<td class="tt off">–</td>`
            : `<td class="tt${isLowPresence(n, m.summary.staff) ? " low" : ""}" style="font-weight:700">${n}</td>`,
        )
        .join("") +
      `<td colspan="6" style="font-size:9px;color:#4A555C">avg ${m.summary.avg_present.toFixed(1)} / day</td></tr></tfoot>`
    : "";
  return `<table>${colgroup}${head}<tbody>${body}</tbody>${foot}</table>`;
}

export function buildPrintDocument(m: ExportModel): string {
  const lines: Line[] = [];
  for (const group of m.groups) {
    lines.push({ kind: "head", group });
    for (const row of group.rows) lines.push({ kind: "row", row });
  }
  const pages = paginateLines(lines);
  const total = pages.length;
  const legend =
    "P present · L late · H half day · V leave · A absent · – weekly off (Saturday). " +
    "Paid = P + L + V + weekly off + ½ H.";
  const body = pages
    .map(
      (page, i) =>
        `<section class="page">${headerHtml(m)}${i === 0 ? boxesHtml(m) : ""}` +
        tableHtml(m, page, i === total - 1) +
        `<footer><span>${legend}</span><span>Page ${i + 1} of ${total}</span></footer></section>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(m.title)}</title><style>${css()}</style></head><body>${body}</body></html>`;
}
