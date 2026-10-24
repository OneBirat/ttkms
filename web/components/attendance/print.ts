/**
 * Print-ready HTML for the attendance report (A4 landscape), matching
 * design/final/ExportPdf.dc.html and ExportPdfNoHoliday.dc.html: ✓ present,
 * overtime hours on yellow, A on red, Saturdays merged per department into a
 * vertical red "SATURDAY" band (or left out when `hide_weekly_off`). The page
 * opens it in a new window and calls print(). TODO backend: same layout as a
 * WeasyPrint template (app/modules/attendance/templates/report.html) served at
 * GET /api/attendance/report/export.pdf.
 */

import { weekdayInitial } from "./bsdate";
import { formatRate, isLowPresence } from "./helpers";
import type { ExportModel } from "./exportModel";
import type { DayCell, DayHeader, ReportRow } from "./types";
import type { DepartmentGroup } from "./helpers";

const esc = (s: string | number) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const PDF_LEGEND =
  "✓ present · number = overtime hours (present + overtime) · A absent · – weekly off (Saturday). " +
  "P counts overtime days too. Paid days = P + W; overtime hours are paid on top.";
export const PDF_LEGEND_NO_SATURDAY =
  "✓ present · number = overtime hours (present + overtime) · A absent. Saturdays (weekly off) are hidden but " +
  "still counted in W. P counts overtime days too. Paid days = P + W; overtime hours are paid on top.";

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

/** Column widths from the mock-up (px); the name column takes what is left. */
export const PDF_COLUMNS = { day: 24, p: 26, o: 30, a: 24, w: 24, paid: 34 };

/** Cell text + inline style for a working day (Saturdays are merged separately). */
export function pdfCell(cell: DayCell): { text: string; style: string } {
  switch (cell.status) {
    case "P":
      return { text: "✓", style: "color:#1E9E4A;font-weight:700" };
    case "O":
      return { text: String(cell.ot_hours), style: "background:#FFF4CC;color:#7A5600;font-weight:700" };
    case "A":
      return { text: "A", style: "background:#F6D9CF;color:#8E2F12;font-weight:700" };
    case "W":
      return { text: "–", style: "background:#EEF0EC;color:#6B757B" };
    default:
      return { text: "", style: "color:#9AA3A9" };
  }
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
.ot { color: #B98900; }
table { border-collapse: collapse; table-layout: fixed; width: 100%; font-size: 10px; }
th, td { border: 1px solid #D5D9D5; text-align: center; padding: 0; height: 19px; }
thead th { background: #F1F3F0; color: #3E4A52; font-weight: 600; height: 30px; line-height: 1.15; }
.nm { text-align: left; padding: 0 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
.wd { font-family: "Noto Sans Devanagari", sans-serif; font-size: 8px; font-weight: 500; }
.sat { color: #8E2F12; }
.satband { background: #FBE9E4; color: #C62828; font-weight: 700; font-size: 8.5px; letter-spacing: .1em; writing-mode: vertical-rl; text-orientation: upright; vertical-align: middle; line-height: 1; }
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
  const hidden = m.hide_weekly_off ? " · Saturdays hidden" : "";
  return `<header>
  <div class="brand"><div class="tile">TT</div>
    <div><h1>${esc(m.title)}</h1>
    <div class="sub">${esc(m.ad_range)} · ${esc(m.filter_label)} · ${m.summary.staff} staff · ${m.summary.working_days} working days${hidden}</div></div>
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
  <div class="box"><span>Overtime</span><span class="ot">${s.overtime_hours}h</span></div>
  <div class="box"><span>Absent days</span><span>${s.absent}</span></div>
</div>`;
}

/** The day columns of the PDF: every day, or working days only. */
export function pdfDays(m: ExportModel): { day: DayHeader; index: number }[] {
  return m.month.days
    .map((day, index) => ({ day, index }))
    .filter((d) => !(m.hide_weekly_off && d.day.is_weekly_off));
}

/**
 * For each line of a page: how many employee rows follow in the same
 * department run (itself included) — the rowspan of the merged Saturday cell
 * on the run's first row; 0 for rows that are not first.
 */
export function saturdaySpans(lines: Line[]): number[] {
  const spans = new Array<number>(lines.length).fill(0);
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind !== "row") {
      i += 1;
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j].kind === "row") j += 1;
    spans[i] = j - i;
    i = j;
  }
  return spans;
}

function tableHtml(m: ExportModel, lines: Line[], withFooter: boolean): string {
  const days = pdfDays(m);
  const span = days.length + 6;
  const c = PDF_COLUMNS;
  const colgroup =
    `<colgroup><col>` +
    days.map(() => `<col style="width:${c.day}px">`).join("") +
    `<col style="width:${c.p}px"><col style="width:${c.o}px"><col style="width:${c.a}px"><col style="width:${c.w}px"><col style="width:${c.paid}px"></colgroup>`;
  const head =
    `<thead><tr><th class="nm">Employee</th>` +
    days
      .map(
        ({ day }) =>
          `<th${day.is_weekly_off ? ' class="sat"' : ""}>${day.bs_day}<br><span class="wd">${weekdayInitial(day.weekday)}</span></th>`,
      )
      .join("") +
    `<th>P</th><th>O</th><th>A</th><th>W</th><th>Paid</th></tr></thead>`;
  const spans = saturdaySpans(lines);
  const body = lines
    .map((line, li) => {
      if (line.kind === "head") {
        const g = line.group;
        return `<tr><th scope="rowgroup" colspan="${span}" class="nm dept">${esc(g.department_name)} <span>· ${g.rows.length} staff · ${formatRate(g.rate)} attendance</span></th></tr>`;
      }
      const r = line.row;
      const t = r.totals;
      const cells = days
        .map(({ day, index }) => {
          if (day.is_weekly_off) {
            // One vertical SATURDAY band per department run; later rows skip the cell.
            return spans[li] ? `<td rowspan="${spans[li]}" class="satband">SATURDAY</td>` : "";
          }
          const cell = pdfCell(r.cells[index]);
          return `<td style="${cell.style}">${cell.text}</td>`;
        })
        .join("");
      return (
        `<tr><th scope="row" class="nm">${esc(r.employee.name)}</th>` +
        cells +
        `<td class="tt">${t.present + t.overtime_days}</td><td class="tt" style="color:#7A5600">${t.overtime_hours}h</td>` +
        `<td class="tt">${t.absent}</td><td class="tt">${t.weekly_off}</td><td class="tt" style="font-weight:700">${t.paid_days}</td></tr>`
      );
    })
    .join("");
  const foot = withFooter
    ? `<tfoot><tr><th class="nm" style="font-weight:700">Staff present (all ${m.summary.staff})</th>` +
      days
        .map(({ index }) => {
          const n = m.staff_present[index];
          return n === null
            ? `<td class="tt off">–</td>`
            : m.open_days[index]
              ? `<td class="tt"></td>`
              : `<td class="tt${isLowPresence(n, m.summary.staff) ? " low" : ""}" style="font-weight:700">${n}</td>`;
        })
        .join("") +
      `<td colspan="5" style="font-size:9px;color:#4A555C">avg ${m.summary.avg_present.toFixed(1)} / day</td></tr></tfoot>`
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
  const legend = m.hide_weekly_off ? PDF_LEGEND_NO_SATURDAY : PDF_LEGEND;
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
