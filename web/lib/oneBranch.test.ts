import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { registerExportUrl, salaryReportExportUrl } from "@/app/people/api";

const WEB = new URL("..", import.meta.url).pathname;

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !path.includes("/mock")) out.push(path);
  }
  return out;
}

describe("one active branch: no page picks its own", () => {
  it("exports and reports carry no branch (the server uses the active one)", () => {
    const month = { bs_year: 2083, bs_month: 7 };
    assert.equal(salaryReportExportUrl(month, "xlsx", 3), "/api/payroll/report/2083-07.xlsx?department_id=3");
    assert.equal(
      registerExportUrl({ from_bs: "2083-07-01", to_bs: "2083-07-09", type: "all", department_id: null, sort: "date" }, "pdf"),
      "/api/payroll/payments/export.pdf?from=2083-07-01&to=2083-07-09&sort=date",
    );
  });

  it("no screen reads ?branch= or renders its own branch drop-down", () => {
    const offenders = [...sources(join(WEB, "app")), ...sources(join(WEB, "components"))].filter((file) => {
      const text = readFileSync(file, "utf8");
      return /params\.get\("branch"\)|aria-label="Branch"|useReportBranch\([^)]/.test(text);
    });
    assert.deepEqual(offenders, []);
  });
});
