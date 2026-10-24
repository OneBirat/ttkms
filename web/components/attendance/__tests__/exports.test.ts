import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AttendanceApiError,
  bulkMarkPresent,
  getDay,
  getEmployeeMonth,
  getMonthBalance,
  getReport,
  getToday,
  lookupCode,
  markOne,
  recordPayment,
  saveDay,
  scanMark,
} from "../api";
import { buildExportModel } from "../exportModel";
import { buildPrintDocument, paginateLines, saturdaySpans } from "../print";
import { buildReportWorkbook, columnName, crc32, workbookToBytes } from "../xlsx";

// Ashwin 2083 (17 Sep – 17 Oct 2026) is in the past, so the mock seed is fixed.
const filters = { month: "2083-06", branch_id: null, department_id: null, query: "", sort: "dept" as const, group: true };
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
  it("has Summary / Daily grid / By department with ✓ / hours / A / – cells and P O A W Paid totals", async () => {
    const model = buildExportModel(await getReport("2083-06"), filters, context);
    const wb = buildReportWorkbook(model);
    assert.deepEqual(wb.sheets.map((s) => s.name), ["Summary", "Daily grid", "By department"]);
    assert.match(String(wb.sheets[0].rows[1][0]), /\d+h overtime · \d+ absences$/);
    const grid = wb.sheets[1];
    assert.equal(grid.freezeRows, 4);
    assert.match(String(grid.rows[0][0]), /^TTK · Attendance report · Ashwin 2083/);
    assert.deepEqual(grid.rows[3].slice(0, 3), ["Emp ID", "Name", "Department"]);
    assert.equal(grid.rows[3][3], "1 बि");
    assert.deepEqual(grid.rows[3].slice(-5), ["P", "O", "A", "W", "Paid"]);
    assert.equal(grid.rows[3].length, 3 + 31 + 5);
    const codes = new Set(grid.rows.slice(4, -1).flatMap((r) => r.slice(3, 3 + 31).map(String)));
    for (const c of codes) assert.match(c, /^(✓|\d{1,2}|A|–|)$/); // number = overtime hours, blank = never marked
    assert.ok(codes.has("✓"));
    const last = grid.rows[grid.rows.length - 1];
    assert.equal(last[0], "Staff present");
    assert.equal(last[3 + 2], "–"); // Ashwin 3 is a Saturday
    assert.equal(grid.rows.length, 4 + model.rows.length + 1);
    assert.deepEqual(wb.sheets[2].rows[3], ["Department", "Staff", "P", "O", "A", "W", "Paid days", "Attendance"]);
    assert.equal(wb.sheets[2].rows.length, 4 + 5 + 1);
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
    assert.match(html, /<span>Overtime<\/span><span class="ot">\d+h<\/span>/);
    assert.match(html, /<th>P<\/th><th>O<\/th><th>A<\/th><th>W<\/th><th>Paid<\/th>/);
    assert.match(html, /<col><col style="width:24px">/);
    assert.match(html, /<col style="width:26px"><col style="width:30px"><col style="width:24px"><col style="width:24px"><col style="width:34px">/);
    assert.match(html, /<td rowspan="7" class="satband">SATURDAY<\/td>/); // Store has 7 staff on page 1
    assert.match(html, /style="color:#1E9E4A;font-weight:700">✓</);
    assert.match(html, /Store <span>· 7 staff/);
    assert.match(html, /Staff present \(all 28\)/);
    assert.match(html, /✓ present · number = overtime hours/);
    assert.match(html, /Page 1 of 2/);
    assert.match(html, /Page 2 of 2/);
    assert.match(html, /<span class="wd">श<\/span>/);
    assert.doesNotMatch(html, /Late|Leave|Half/);
  });
  it("can leave the Saturday columns out", async () => {
    const model = buildExportModel(await getReport("2083-06"), { ...filters, hide_weekly_off: true }, context);
    const html = buildPrintDocument(model);
    assert.match(html, /26 working days · Saturdays hidden/);
    assert.doesNotMatch(html, /SATURDAY/);
    assert.doesNotMatch(html, /<span class="wd">श<\/span>/);
    assert.match(html, /Saturdays \(weekly off\) are hidden/);
    assert.equal((html.match(/<th>\d+<br>/g) ?? []).length, 26 * 2); // 26 working days on each of 2 pages
  });
  it("merges Saturdays per department run on a page", () => {
    const head = { kind: "head" as const, group: { department_id: 1, department_name: "x", rows: [], rate: null } };
    const row = { kind: "row" as const, row: { employee: { id: 1 } as never, cells: [], totals: {} as never } };
    assert.deepEqual(saturdaySpans([head, row, row, row, head, row]), [0, 3, 0, 0, 0, 1]);
    assert.deepEqual(saturdaySpans([row, row]), [2, 0]); // a run continued from the previous page
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
    assert.equal(row.cells[2].status, "O");
    assert.equal(row.cells[2].ot_hours, 3);
    assert.equal(row.totals.weekly_off, 4);
    await assert.rejects(
      saveDay({ date_bs: "2083-06-32", rows: [] }),
      (e: unknown) => e instanceof AttendanceApiError && e.status === 422,
    );
  });
  it("per-mark save upserts one record and reports what it replaced", async () => {
    const first = await markOne({ date_bs: "2083-06-02", employee_id: 5, status: "A", ot_hours: 0 });
    assert.equal(first.record.status, "A");
    const second = await markOne({ date_bs: "2083-06-02", employee_id: 5, status: "O", ot_hours: 2 });
    assert.equal(second.previous, "A");
    assert.equal(second.record.ot_hours, 2);
    await assert.rejects(
      markOne({ date_bs: "2083-06-02", employee_id: 5, status: "O", ot_hours: 0 }),
      (e: unknown) => e instanceof AttendanceApiError && e.status === 422,
    );
    await assert.rejects(
      markOne({ date_bs: "2083-06-02", employee_id: 9999, status: "P", ot_hours: 0 }),
      (e: unknown) => e instanceof AttendanceApiError && e.status === 404,
    );
  });
  it("bulk-mark writes Present only for the unmarked in scope, in one call", async () => {
    // Today is only partly seeded, so there is something left to mark.
    const date_bs = (await getToday()).bs_date;
    const before = await getDay(date_bs, 1);
    const dept = before.departments[0].id;
    const openIds = before.rows.filter((r) => r.employee.department_id === dept && !r.record).map((r) => r.employee.id);
    const doneIds = before.rows.filter((r) => r.employee.department_id === dept && r.record).map((r) => r.employee.id);
    const res = await bulkMarkPresent({ date_bs, branch_id: 1, department_id: dept });
    assert.deepEqual(res.marked.map((m) => m.employee_id).sort(), openIds.sort());
    assert.deepEqual([...res.skipped].sort(), doneIds.sort());
    assert.ok(res.records.every((r) => r.status === "P" && r.ot_hours === 0 && r.marked_via === "manual"));
    const again = await bulkMarkPresent({ date_bs, branch_id: 1, employee_ids: openIds });
    assert.equal(again.marked.length, 0);
    assert.equal(again.skipped.length, openIds.length);
    await assert.rejects(
      bulkMarkPresent({ date_bs, branch_id: 1 }),
      (e: unknown) => e instanceof AttendanceApiError && e.status === 422,
    );
  });
  it("employee month carries cells, totals and payments for the record screen", async () => {
    const m = await getEmployeeMonth(4, "2083-06");
    assert.equal(m.employee.id, 4);
    assert.equal(m.month.bs_month, 6);
    assert.equal(m.cells.length, 31);
    assert.equal(m.totals.paid_days, m.totals.present + m.totals.overtime_days + m.totals.weekly_off);
    assert.ok(Array.isArray(m.payments));
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
