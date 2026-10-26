// The app-page guard (middleware.ts) behind Caddy: redirects go to the address the browser used
// (Host / X-Forwarded-* from Caddy), never to the Next.js server's own 127.0.0.1:3000.
import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

const BEHIND_CADDY = {
  host: "203.0.113.7",
  "x-forwarded-host": "203.0.113.7",
  "x-forwarded-proto": "https",
};

test("no session cookie -> /login with next=, on the browser's address", async () => {
  const request = new NextRequest("http://localhost:3000/people/salary?month=6", {
    headers: BEHIND_CADDY,
  });
  const response = await middleware(request);
  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("location"),
    "https://203.0.113.7/login?next=%2Fpeople%2Fsalary%3Fmonth%3D6",
  );
});

test("development (no proxy): the Host header", async () => {
  const request = new NextRequest("http://localhost:3000/attendance/mark", {
    headers: { host: "localhost:3000" },
  });
  const response = await middleware(request);
  assert.equal(response.headers.get("location"), "http://localhost:3000/login?next=%2Fattendance%2Fmark");
});

test("a module that is turned off -> /module-off", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ enabled: ["attendance"] }));
  const request = new NextRequest("http://127.0.0.1:3000/people/salary", {
    headers: { ...BEHIND_CADDY, cookie: "ttk_session=x" },
  });
  const response = await middleware(request);
  assert.equal(response.headers.get("location"), "https://203.0.113.7/module-off?module=payroll");
});
