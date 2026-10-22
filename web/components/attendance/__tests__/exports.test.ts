import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildExportModel } from "../exportModel";
import { buildPrintDocument, paginateLines } from "../print";
import { buildReportWorkbook, columnName, crc32, workbookToBytes } from "../xlsx";
import { getReport } from "../api";

const filters = { month: "2083-06", department_id: null, query: "", sort: "dept" as const, group: true };
const context = { company: "TTK", printedBy: "Admin", today: null, now: new Date(2026, 9, 20, 16, 20) };

describe("export model", () => {
  it("includes everyone in the filter, grouped by department", async () => {
    const report = await getReport("2083-06");
    const model = buildExportModel(report, filters, context);
    assert.equal(model.rows.length, report.rows.length);
    assert.equal(model.groups.length, 5);
    assert.equal(model.title, "Attendance report · Ashwin 2083");
    assert.equal(model.ad_range, "17 Sep – 16 Oct 2026");
    assert.equal(model.filter_label, "All departments");
    assert.equal(model.summary.working_days, 26);
    assert.equal(model.staff_present.length, 30);
    assert.match(model.printed_at_ad, /^20 Oct 2026, 16:20$/);
  });
  it("respects a department filter and search", async () => {
    const report = await getReport("2083-06");
    const model = buildExportModel(report, { ...filters, department_id: 1, query: "an" }, context);
    assert.ok(model.rows.every((r) => r.employee.department_id === 1));
    assert.ok(model.rows.every((r) => /an/i.test(r.employee.name)));
    assert.equal(model.filter_label, 'Store · search "an"');
  });
});

describe("Excel workbook", () => {
  it("has the four sheets with title rows, frozen header and the staff-present row", async () => {
    const model = buildExportModel(await getReport("2083-06"), filters, context);
    const wb = buildReportWorkbook(model);
    assert.deepEqual(wb.sheets.map((s) => s.name), ["Summary", "Daily grid", "In–out times", "By department"]);
    const grid = wb.sheets[1];
    assert.equal(grid.freezeRows, 4);
    assert.match(String(grid.rows[0][0]), /^TTK · Attendance report · Ashwin 2083/);
    assert.deepEqual(grid.rows[3].slice(0, 3), ["Emp ID", "Name", "Department"]);
    assert.equal(grid.rows[3][3], "1 बि");
    assert.equal(grid.rows[3].length, 3 + 30 + 6);
    const last = grid.rows[grid.rows.length - 1];
    assert.equal(last[0], "Staff present");
    assert.equal(last[3 + 2], "–"); // Ashoj 3 is a Saturday
    assert.equal(grid.rows.length, 4 + model.rows.length + 1);
    assert.equal(wb.sheets[2].rows[3].length, 3 + 30);
    assert.equal(wb.sheets[3].rows.length, 4 + 5 + 1);
  });
  it("writes a zip whose first bytes are a local file header", async () => {
    const model = buildExportModel(await getReport("2083-06"), filters, context);
    const bytes = workbookToBytes(buildReportWorkbook(model));
    assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
    assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
    assert.equal(columnName(0), "A");
    assert.equal(columnName(26), "AA");
  });
});

describe("PDF print document", () => {
  it("renders header, summary boxes, department groups, footer row and page numbers", async () => {
    const model = buildExportModel(await getReport("2083-06"), filters, context);
    const html = buildPrintDocument(model);
    assert.match(html, /size: A4 landscape/);
    assert.match(html, /Attendance report · Ashwin 2083/);
    assert.match(html, /17 Sep – 16 Oct 2026 · All departments · 28 staff · 26 working days/);
    assert.match(html, /Generated 20 Oct 2026, 16:20 by Admin/);
    assert.match(html, /Total staff/);
    assert.match(html, /Store <span>· 7 staff/);
    assert.match(html, /Staff present \(all 28\)/);
    assert.match(html, /Page 1 of 2/);
    assert.match(html, /Page 2 of 2/);
    assert.match(html, /<span class="wd">श<\/span>/);
  });
  it("paginates lines into first/rest capacities", () => {
    const lines = Array.from({ length: 50 }, () => ({ kind: "head" as const, group: { department_id: 1, department_name: "x", rows: [], rate: null } }));
    const pages = paginateLines(lines, { first: 20, rest: 27 });
    assert.deepEqual(pages.map((p) => p.length), [20, 27, 3]);
    assert.equal(paginateLines([], { first: 20, rest: 27 }).length, 1);
  });
});
