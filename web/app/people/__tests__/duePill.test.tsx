import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AttendanceCalendarCard, duePill } from "../_components/AccountCards";
import type { Employee } from "../types";

describe("attendance card footer: total due pill", () => {
  it("Due {total} in red while owing, No dues ✓ in green at 0", () => {
    assert.deepEqual(duePill(28230), { text: "Due 28,230", owing: true });
    assert.deepEqual(duePill(0), { text: "No dues ✓", owing: false });
  });

  it("no View all link; the pill only for salary_advances", () => {
    const employee = { id: 7, joined: { bs: "2082-01-01", ad: "2025-04-14" } } as unknown as Employee;
    const html = renderToStaticMarkup(createElement(AttendanceCalendarCard, { employee, structure: null, showDue: false }));
    assert.doesNotMatch(html, /View all/);
    assert.doesNotMatch(html, /due-pill|Due \d|No dues/);
  });
});
