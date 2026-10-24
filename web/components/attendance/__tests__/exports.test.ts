import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AttendanceApiError, getMonthBalance, getReport, lookupCode, recordPayment, saveDay, scanMark } from "../api";
import { buildExportModel } from "../exportModel";
import { buildPrintDocument, paginateLines } from "../print";
import { buildReportWorkbook, columnName, crc32, workbookToBytes } from "../xlsx";

// Ashwin 2083 (17 Sep – 17 Oct 2026) is in the past, so the mock seed is fixed.
const filters = { month: "2083-06", department_id: null, query: "", sort: "dept" as const, group: true };
const context = { company: "TTK", printedBy: "Admin", today: null, now: new Date(2026, 9, 20, 16, 20) };

describe("export model", () => {
  it("includes everyone in the filter, grouped by department", async () => {
    const report = await getReport("2083-06");
    const model = buildExportModel(report, filters, context);
    assert.equal(model.rows.length, report.rows.length);
    assert.equal(model.rows.length, 28);
    assert.equal(model.groups.length, 5);
    assert.equal(model.title, "Attendance report · Ashwin 2083");
    assert.equal(model.ad_range, "17 Sep – 17 Oct 2026");
    assert.equal(model.filter_label, "All departments");
    assert.equal(model.summary.working_days, 26);
    assert.equal(model.staff_present.length, 31);
    assert.ok(model.summary.overtime_hours > 0);
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
  it("has the four sheets with P/O/A codes, an overtime-hours column and the staff-present row", async () => {
    const model = buildExportModel(await getReport("2083-06"), filters, context);
    const wb = buildReportWorkbook(model);
    assert.deepEqual(wb.sheets.map((s) => s.name), ["Summary", "Daily grid", "Overtime hours", "By department"]);
    const grid = wb.sheets[1];
    assert.equal(grid.freezeRows, 4);
    assert.match(String(grid.rows[0][0]), /^TTK · Attendance report · Ashwin 2083/);
    assert.deepEqual(grid.rows[3].slice(0, 3), ["Emp ID", "Name", "Department"]);
    assert.equal(grid.rows[3][3], "1 बि");
    assert.deepEqual(grid.rows[3].slice(-4), ["P", "O h", "A", "Paid"]);
    assert.equal(grid.rows[3].length, 3 + 31 + 4);
    const codes = new Set(grid.rows.slice(4, -1).flatMap((r) => r.slice(3, 3 + 31).map(String)));
    for (const c of codes) assert.match(c, /^(P|O\d{1,2}|A|–|)$/); // blank = never marked
    const last = grid.rows[grid.rows.length - 1];
    assert.equal(last[0], "Staff present");
    assert.equal(last[3 + 2], "–"); // Ashwin 3 is a Saturday
    assert.equal(grid.rows.length, 4 + model.rows.length + 1);
    assert.equal(wb.sheets[2].rows[3].length, 3 + 31 + 1);
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
  it("renders header, summary boxes, department groups, footer row, legend and page numbers", async () => {
    const model = buildExportModel(await getReport("2083-06"), filters, context);
    const html = buildPrintDocument(model);
    assert.match(html, /size: A4 landscape/);
    assert.match(html, /Attendance report · Ashwin 2083/);
    assert.match(html, /17 Sep – 17 Oct 2026 · All departments · 28 staff · 26 working days/);
    assert.match(html, /Generated 20 Oct 2026, 16:20 by Admin/);
    assert.match(html, /Overtime hours/);
    assert.match(html, /<th>P<\/th><th>O h<\/th><th>A<\/th><th>Paid<\/th>/);
    assert.match(html, /Store <span>· 7 staff/);
    assert.match(html, /Staff present \(all 28\)/);
    assert.match(html, /P present · O overtime \(hours\) · A absent · – weekly off/);
    assert.match(html, /Page 1 of 2/);
    assert.match(html, /Page 2 of 2/);
    assert.match(html, /<span class="wd">श<\/span>/);
    assert.doesNotMatch(html, /Late|Leave|Half/);
  });
  it("paginates lines into first/rest capacities", () => {
    const lines = Array.from({ length: 50 }, () => ({ kind: "head" as const, group: { department_id: 1, department_name: "x", rows: [], rate: null } }));
    const pages = paginateLines(lines, { first: 20, rest: 27 });
    assert.deepEqual(pages.map((p) => p.length), [20, 27, 3]);
    assert.equal(paginateLines([], { first: 20, rest: 27 }).length, 1);
  });
});

describe("mock API rules", () => {
  it("saves all rows or none and validates overtime hours", async () => {
    const ok = await saveDay({
      date_bs: "2083-06-01",
      rows: [
        { employee_id: 1, status: "O", ot_hours: 2, note: "" },
        { employee_id: 2, status: "A", ot_hours: 0, note: "sick" },
      ],
    });
    assert.equal(ok.saved, 2);
    assert.equal(ok.records[0].ot_hours, 2);
    assert.equal(ok.records[1].marked_via, "manual");
    await assert.rejects(
      saveDay({ date_bs: "2083-06-01", rows: [{ employee_id: 1, status: "O", ot_hours: 0, note: "" }] }),
      (e: unknown) => e instanceof AttendanceApiError && e.status === 422,
    );
    // The weekly off needs no marks, but overtime worked on a Saturday is recorded and reported.
    const sat = await saveDay({ date_bs: "2083-06-03", rows: [{ employee_id: 3, status: "O", ot_hours: 3, note: "" }] });
    assert.equal(sat.saved, 1);
    const row = (await getReport("2083-06")).rows.find((r) => r.employee.id === 3)!;
    assert.deepEqual(row.cells[2], { status: "O", ot_hours: 3 });
    assert.equal(row.totals.weekly_off, 4);
    await assert.rejects(
      saveDay({ date_bs: "2083-06-32", rows: [] }),
      (e: unknown) => e instanceof AttendanceApiError && e.status === 422,
    );
  });
  it("looks up every code shape and 404s unknown cards", async () => {
    const found = await lookupCode("TTK-E004");
    assert.equal(found.employee.name, "Kamala Bhandari");
    assert.equal((await lookupCode("4")).employee.id, 4);
    await assert.rejects(lookupCode("TTK-X917"), (e: unknown) => e instanceof AttendanceApiError && e.status === 404);
  });
  it("scan marks today at once", async () => {
    const r = await scanMark({ code: "E-011", action: "overtime", ot_hours: 2 });
    assert.equal(r.record.status, "O");
    assert.equal(r.record.ot_hours, 2);
    assert.equal(r.record.marked_via, "scan");
    assert.equal((await lookupCode("E011")).today?.ot_hours, 2);
  });
  it("payroll client: balance, payment, due after", async () => {
    const before = await getMonthBalance(4, "2083-07");
    assert.equal(before.month_label, "Kartik 2083");
    assert.equal(before.due, before.net - before.paid);
    const paid = await recordPayment({ employee_id: 4, month_key: "2083-07", type: "advance", amount: 1500, method: "cash", source: "scan" });
    assert.equal(paid.due_after, before.due - 1500);
    const after = await getMonthBalance(4, "2083-07");
    assert.equal(after.paid, before.paid + 1500);
    await assert.rejects(
      recordPayment({ employee_id: 4, month_key: "2083-07", type: "salary", amount: after.due + 1, method: "bank", source: "scan" }),
      (e: unknown) => e instanceof AttendanceApiError && e.status === 422,
    );
  });
});
