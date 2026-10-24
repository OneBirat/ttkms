/**
 * Minimal .xlsx writer with no dependencies: several sheets, inline strings,
 * numbers, formulas, a handful of cell styles, column widths and a header
 * autofilter per sheet. Enough for the register export until the backend
 * serves the real file through app/core/export.py (openpyxl).
 *
 * The container is a ZIP with stored (uncompressed) entries and CRC-32s, so
 * Excel, LibreOffice and Numbers open it as a normal workbook.
 */

export type StyleName = "normal" | "bold" | "title" | "muted" | "header" | "headerDark" | "number" | "numberBold" | "total";

export interface StyledCell {
  v?: string | number | null;
  /** Formula without the leading "=". */
  f?: string;
  s?: StyleName;
}

export type Cell = string | number | null | StyledCell;

export interface Sheet {
  name: string;
  rows: Cell[][];
  /** Column widths in characters, by column index. */
  widths?: number[];
  /** "A4:J20" — header row + data; Excel shows the filter dropdowns on the header. */
  autoFilter?: string;
}

const STYLE_INDEX: Record<StyleName, number> = {
  normal: 0,
  bold: 1,
  title: 2,
  muted: 3,
  header: 4,
  headerDark: 5,
  number: 6,
  numberBold: 7,
  total: 8,
};

/** "A", "B", … "AA" for a 0-based column index. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** "J20" for column 9, row 20 (1-based row). */
export function cellRef(col: number, row: number): string {
  return `${columnLetter(col)}${row}`;
}

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] ?? c);
}

/** Sheet names: 31 chars, none of : \ / ? * [ ] */
function sheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31);
}

function cellXml(cell: Cell, col: number, row: number): string {
  const ref = cellRef(col, row);
  const styled: StyledCell = cell !== null && typeof cell === "object" ? cell : { v: cell };
  const style = styled.s ? ` s="${STYLE_INDEX[styled.s]}"` : "";
  if (styled.f) {
    const cached = typeof styled.v === "number" ? `<v>${styled.v}</v>` : "";
    return `<c r="${ref}"${style}><f>${escapeXml(styled.f)}</f>${cached}</c>`;
  }
  if (styled.v === null || styled.v === undefined || styled.v === "") {
    return style ? `<c r="${ref}"${style}/>` : "";
  }
  if (typeof styled.v === "number") {
    return `<c r="${ref}"${style}><v>${Number.isFinite(styled.v) ? styled.v : 0}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(String(styled.v))}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const cols = sheet.widths?.length
    ? `<cols>${sheet.widths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(2, w)}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";
  const rows = sheet.rows
    .map((cells, r) => {
      const inner = cells.map((cell, c) => cellXml(cell, c, r + 1)).join("");
      return `<row r="${r + 1}">${inner}</row>`;
    })
    .join("");
  const filter = sheet.autoFilter ? `<autoFilter ref="${sheet.autoFilter}"/>` : "";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
    cols +
    `<sheetData>${rows}</sheetData>` +
    filter +
    `</worksheet>`
  );
}

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>` +
  `<fonts count="5">` +
  `<font><sz val="11"/><name val="Calibri"/></font>` +
  `<font><b/><sz val="11"/><name val="Calibri"/></font>` +
  `<font><b/><sz val="13"/><name val="Calibri"/></font>` +
  `<font><sz val="11"/><color rgb="FF5B6670"/><name val="Calibri"/></font>` +
  `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>` +
  `</fonts>` +
  `<fills count="5">` +
  `<fill><patternFill patternType="none"/></fill>` +
  `<fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFE7F1EF"/><bgColor indexed="64"/></patternFill></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FF1F5C45"/><bgColor indexed="64"/></patternFill></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F3"/><bgColor indexed="64"/></patternFill></fill>` +
  `</fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="9">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` + // 0 normal
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` + // 1 bold
  `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` + // 2 title
  `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>` + // 3 muted
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` + // 4 header
  `<xf numFmtId="0" fontId="4" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` + // 5 headerDark
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` + // 6 number
  `<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>` + // 7 numberBold
  `<xf numFmtId="164" fontId="1" fillId="4" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>` + // 8 total
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

function workbookXml(sheets: Sheet[]): string {
  const entries = sheets
    .map((s, i) => `<sheet name="${escapeXml(sheetName(s.name))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("");
  const filters = sheets
    .map((s, i) =>
      s.autoFilter
        ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${escapeXml(sheetName(s.name)).replace(/'/g, "''")}'!${s.autoFilter
            .split(":")
            .map((ref) => ref.replace(/([A-Z]+)(\d+)/, "$$$1$$$2"))
            .join(":")}</definedName>`
        : "",
    )
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${entries}</sheets>` +
    (filters ? `<definedNames>${filters}</definedNames>` : "") +
    `</workbook>`
  );
}

function workbookRels(sheets: Sheet[]): string {
  const rels = sheets
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}` +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`
  );
}

function contentTypes(sheets: Sheet[]): string {
  const overrides = sheets
    .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    overrides +
    `</Types>`
  );
}

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
  `</Relationships>`;

/** The parts of the package, in order. Exported for tests. */
export function workbookParts(sheets: Sheet[]): { name: string; data: string }[] {
  return [
    { name: "[Content_Types].xml", data: contentTypes(sheets) },
    { name: "_rels/.rels", data: ROOT_RELS },
    { name: "xl/workbook.xml", data: workbookXml(sheets) },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRels(sheets) },
    { name: "xl/styles.xml", data: STYLES_XML },
    ...sheets.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(sheet) })),
  ];
}

// ------------------------------------------------------------------- zip

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}
function u32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

/** Stored ZIP (no compression) of the given UTF-8 text entries. */
export function zipStored(entries: { name: string; data: string }[]): Uint8Array {
  const encoder = new TextEncoder();
  const files = entries.map((e) => ({ name: encoder.encode(e.name), data: encoder.encode(e.data) }));
  const localSize = files.reduce((n, f) => n + 30 + f.name.length + f.data.length, 0);
  const centralSize = files.reduce((n, f) => n + 46 + f.name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  const offsets: number[] = [];
  const crcs: number[] = [];
  let p = 0;
  // DOS date/time: 2026-01-01 00:00 (fixed so the output is reproducible).
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  files.forEach((f) => {
    const crc = crc32(f.data);
    offsets.push(p);
    crcs.push(crc);
    u32(view, p, 0x04034b50);
    u16(view, p + 4, 20);
    u16(view, p + 6, 0x0800); // UTF-8 names
    u16(view, p + 8, 0); // stored
    u16(view, p + 10, dosTime);
    u16(view, p + 12, dosDate);
    u32(view, p + 14, crc);
    u32(view, p + 18, f.data.length);
    u32(view, p + 22, f.data.length);
    u16(view, p + 26, f.name.length);
    u16(view, p + 28, 0);
    out.set(f.name, p + 30);
    out.set(f.data, p + 30 + f.name.length);
    p += 30 + f.name.length + f.data.length;
  });
  const centralStart = p;
  files.forEach((f, i) => {
    u32(view, p, 0x02014b50);
    u16(view, p + 4, 20);
    u16(view, p + 6, 20);
    u16(view, p + 8, 0x0800);
    u16(view, p + 10, 0);
    u16(view, p + 12, dosTime);
    u16(view, p + 14, dosDate);
    u32(view, p + 16, crcs[i]);
    u32(view, p + 20, f.data.length);
    u32(view, p + 24, f.data.length);
    u16(view, p + 28, f.name.length);
    u16(view, p + 30, 0);
    u16(view, p + 32, 0);
    u16(view, p + 34, 0);
    u16(view, p + 36, 0);
    u32(view, p + 38, 0);
    u32(view, p + 42, offsets[i]);
    out.set(f.name, p + 46);
    p += 46 + f.name.length;
  });
  u32(view, p, 0x06054b50);
  u16(view, p + 4, 0);
  u16(view, p + 6, 0);
  u16(view, p + 8, files.length);
  u16(view, p + 10, files.length);
  u32(view, p + 12, p - centralStart);
  u32(view, p + 16, centralStart);
  u16(view, p + 20, 0);
  return out;
}

/** The whole .xlsx as bytes. */
export function buildXlsx(sheets: Sheet[]): Uint8Array {
  return zipStored(workbookParts(sheets));
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
