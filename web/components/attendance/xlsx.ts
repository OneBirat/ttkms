/**
 * Minimal .xlsx writer (no dependencies): sheets of inline-string / number
 * cells, a frozen header row per sheet, stored (uncompressed) zip. Enough for
 * the mock export; the backend will use openpyxl (app/core/export.py).
 */

import { formatRate, statusCode, weekdayInitial } from "./helpers";
import type { ExportModel } from "./exportModel";

export type SheetCell = string | number | null;

export interface Sheet {
  name: string;
  rows: SheetCell[][];
  /** Number of top rows to freeze (0 = none). */
  freezeRows: number;
  /** Column widths in characters, optional. */
  colWidths?: number[];
}

export interface Workbook {
  sheets: Sheet[];
}

// ------------------------------------------------------------ workbook model

export function buildReportWorkbook(model: ExportModel): Workbook {
  const m = model.month;
  const s = model.summary;
  const dayHeads = m.days.map((d) => `${d.bs_day} ${weekdayInitial(d.weekday)}`);
  const titleRow = [`${model.company} · Attendance report · ${m.label} (${model.ad_range})`];
  const summaryLine =
    `${model.filter_label} · ${s.staff} staff · avg ${s.avg_present.toFixed(1)} present per ` +
    `working day (${formatRate(s.rate)}) · ${s.late} late arrivals · ${s.absent} absences · ` +
    `${s.leave} leave days`;
  const totalsHead = ["P", "L", "H", "V", "A", "Paid"];
  const totalsOf = (r: ExportModel["rows"][number]) => [
    r.totals.present,
    r.totals.late,
    r.totals.half_day,
    r.totals.leave,
    r.totals.absent,
    r.totals.paid_days,
  ];
  const presentRow = (prefix: SheetCell[]) => [
    ...prefix,
    ...model.staff_present.map((n) => (n === null ? "–" : n)),
    `avg ${s.avg_present.toFixed(1)}`,
  ];

  const summary: Sheet = {
    name: "Summary",
    freezeRows: 0,
    colWidths: [30, 18],
    rows: [
      titleRow,
      [summaryLine],
      [],
      ["Metric", "Value"],
      ["Period (BS)", m.label],
      ["Period (AD)", model.ad_range],
      ["Filter", model.filter_label],
      ["Working days", s.working_days],
      ["Total staff", s.staff],
      ["Present per working day (avg)", Number(s.avg_present.toFixed(1))],
      ["Attendance rate", formatRate(s.rate)],
      ["Total present days", s.present_days],
      ["Late arrivals", s.late],
      ["Absent days", s.absent],
      ["Leave days", s.leave],
      [],
      ["Paid days = present + late + leave + weekly off + ½ per half day. Absent is unpaid."],
      [`Generated ${model.printed_at_ad} by ${model.printed_by}`],
    ],
  };

  const grid: Sheet = {
    name: "Daily grid",
    freezeRows: 4,
    colWidths: [8, 22, 14, ...m.days.map(() => 4.5), 4, 4, 4, 4, 4, 6],
    rows: [
      titleRow,
      [summaryLine],
      [],
      ["Emp ID", "Name", "Department", ...dayHeads, ...totalsHead],
      ...model.rows.map((r) => [
        r.employee.code,
        r.employee.name,
        r.employee.department_name,
        ...r.cells.map((c) => statusCode(c.status)),
        ...totalsOf(r),
      ]),
      presentRow(["Staff present", "", ""]),
    ],
  };

  const times: Sheet = {
    name: "In–out times",
    freezeRows: 4,
    colWidths: [8, 22, 14, ...m.days.map(() => 12)],
    rows: [
      titleRow,
      ["In–out times per day (HH:MM–HH:MM); blank when nothing was recorded"],
      [],
      ["Emp ID", "Name", "Department", ...dayHeads],
      ...model.rows.map((r) => [
        r.employee.code,
        r.employee.name,
        r.employee.department_name,
        ...r.cells.map((c) =>
          c.in_time || c.out_time ? `${c.in_time ?? ""}–${c.out_time ?? ""}` : statusCode(c.status),
        ),
      ]),
    ],
  };

  const byDept: Sheet = {
    name: "By department",
    freezeRows: 4,
    colWidths: [18, 8, 8, 8, 8, 8, 8, 10, 12],
    rows: [
      titleRow,
      [summaryLine],
      [],
      ["Department", "Staff", "P", "L", "H", "V", "A", "Paid days", "Attendance"],
      ...model.groups.map((g) => {
        const t = g.rows.reduce(
          (acc, r) => ({
            present: acc.present + r.totals.present,
            late: acc.late + r.totals.late,
            half_day: acc.half_day + r.totals.half_day,
            leave: acc.leave + r.totals.leave,
            absent: acc.absent + r.totals.absent,
            paid: acc.paid + r.totals.paid_days,
          }),
          { present: 0, late: 0, half_day: 0, leave: 0, absent: 0, paid: 0 },
        );
        return [
          g.department_name,
          g.rows.length,
          t.present,
          t.late,
          t.half_day,
          t.leave,
          t.absent,
          t.paid,
          formatRate(g.rate),
        ];
      }),
      [
        "All in filter",
        model.rows.length,
        ...["present", "late", "half_day", "leave", "absent"].map((k) =>
          model.rows.reduce((a, r) => a + r.totals[k as "present"], 0),
        ),
        model.rows.reduce((a, r) => a + r.totals.paid_days, 0),
        formatRate(model.rate_all),
      ],
    ],
  };

  return { sheets: [summary, grid, times, byDept] };
}

// ------------------------------------------------------------ xml

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function columnName(index: number): string {
  let i = index + 1;
  let name = "";
  while (i > 0) {
    const m = (i - 1) % 26;
    name = String.fromCharCode(65 + m) + name;
    i = Math.floor((i - 1) / 26);
  }
  return name;
}

function sheetXml(sheet: Sheet): string {
  const cols = sheet.colWidths?.length
    ? `<cols>${sheet.colWidths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          if (value === null || value === "") return "";
          const ref = `${columnName(c)}${r + 1}`;
          if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  const pane =
    sheet.freezeRows > 0
      ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sheet.freezeRows}" topLeftCell="A${sheet.freezeRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      : "";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `${pane}${cols}<sheetData>${rows}</sheetData></worksheet>`
  );
}

function workbookFiles(workbook: Workbook): { name: string; data: string }[] {
  const sheets = workbook.sheets;
  const safeName = (n: string) => xmlEscape(n.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
  return [
    {
      name: "[Content_Types].xml",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        sheets
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join("") +
        `</Types>`,
    },
    {
      name: "_rels/.rels",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets>` +
        sheets
          .map((s, i) => `<sheet name="${safeName(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
          .join("") +
        `</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join("") +
        `</Relationships>`,
    },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];
}

// ------------------------------------------------------------ zip (stored)

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff];
}

function u32(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

/** Builds a stored (method 0) zip from text files. */
export function zipStored(files: { name: string; data: string }[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: number[] = [];
  const central: number[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.data);
    const crc = crc32(data);
    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0),
    ];
    chunks.push(...local, ...name, ...data);
    central.push(
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0),
      ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name,
    );
    offset += local.length + name.length + data.length;
  }
  const end = [
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
    ...u32(central.length), ...u32(offset), ...u16(0),
  ];
  return new Uint8Array([...chunks, ...central, ...end]);
}

export const XLSX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function workbookToBytes(workbook: Workbook): Uint8Array {
  return zipStored(workbookFiles(workbook));
}

export function workbookToBlob(workbook: Workbook): Blob {
  return new Blob([workbookToBytes(workbook) as BlobPart], { type: XLSX_MEDIA_TYPE });
}
