import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDay, getReport } from "../mock/mockApi";
import { loadDepartments } from "../departments";
import { DEPARTMENTS, EMPLOYEES, departmentRefs } from "../mock/employees";

describe("departments from core", () => {
  it("falls back to the mock seed when no server is reachable (node)", async () => {
    assert.deepEqual(await loadDepartments(), DEPARTMENTS);
  });
  it("headcount joins the given core list on department_id, keeping core's names", () => {
    const refs = departmentRefs(null, [{ id: 1, name: "Stores" }, { id: 9, name: "Delivery" }]);
    assert.deepEqual(refs, [
      { id: 1, name: "Stores", headcount: EMPLOYEES.filter((e) => e.department_id === 1).length },
      { id: 9, name: "Delivery", headcount: 0 },
    ]);
    const branch = departmentRefs(2, [{ id: 1, name: "Stores" }]);
    assert.equal(branch[0].headcount, EMPLOYEES.filter((e) => e.department_id === 1 && e.branch_id === 2).length);
  });
  it("the day and the report carry the department list", async () => {
    const day = await getDay("2083-07-04", 1);
    assert.deepEqual(day.departments.map((d) => d.name), DEPARTMENTS.map((d) => d.name));
    const report = await getReport("2083-06");
    assert.ok(report.departments.every((d) => d.headcount > 0));
  });
});
