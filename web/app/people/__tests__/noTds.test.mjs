import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ledgerCsv, payrollSheetCsv, payslipHtml } from "../_lib/exports.ts";
import * as api from "../_lib/mockApi.ts";

// TDS stays in the data (always 0) but is never shown: screens, CSVs, payslips.
test("no TDS in the People screens", () => {
  const root = new URL("../_components", import.meta.url).pathname;
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".tsx")) files.push(path);
    }
  };
  walk(root);
  assert.ok(files.length > 20);
  assert.deepEqual(files.filter((f) => /\bTDS\b|\.tds\b|"tds"/.test(readFileSync(f, "utf8"))), []);
});

test("no TDS in the client CSVs and the payslip", async () => {
  await api.resetMockData(new Date("2026-10-24T06:00:00Z"));
  const [employee] = await api.listEmployees();
  const ledgers = await api.getLedger(employee.id);
  assert.ok(ledgers.length > 0);
  assert.doesNotMatch(ledgerCsv(employee, ledgers), /TDS/);
  assert.doesNotMatch(payslipHtml(employee, ledgers[0]), /TDS/);
  const report = await api.getSalaryReport(ledgers[0].month);
  assert.doesNotMatch(payrollSheetCsv(report.rows), /TDS/);
});
