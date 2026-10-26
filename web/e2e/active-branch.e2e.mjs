// End-to-end check of the ONE active branch in a real browser (headless Chrome over CDP, no extra
// dependency). Needs the API and the Next.js dev server running, Google Chrome, and two users:
//
//   E2E_BASE=http://localhost:3000 E2E_API=http://localhost:8000 \
//   E2E_ADMIN=admin:password E2E_STAFF=clerk:password \
//   node e2e/active-branch.e2e.mjs           (or: npm run e2e:branch)
//
// The admin needs see_other_branches and at least two active branches; the staff user must not
// have see_other_branches. The admin's active branch is put back at the end.
//
// Checks: switching on the dashboard -> Salary report, Payment reports, Employees and Mark
// attendance open on the same branch; the switch survives a reload and reaches a second tab;
// ?branch= is applied once and removed from the URL; staff see no tabs and no switcher menu;
// "Compare branches" does not change the active branch, "Open" does.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const API = process.env.E2E_API ?? "http://localhost:8000";
const CHROME = process.env.E2E_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.E2E_CDP_PORT ?? 9341);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function creds(name) {
  const value = process.env[name];
  if (!value || !value.includes(":")) throw new Error(`Set ${name}=username:password`);
  const i = value.indexOf(":");
  return { username: value.slice(0, i), password: value.slice(i + 1) };
}

/** Log in against the API; returns the session cookie value and a JSON fetch helper. */
async function apiLogin({ username, password }) {
  let cookie = "";
  const call = async (path, init = {}) => {
    const res = await fetch(API + path, { ...init, headers: { ...(init.headers ?? {}), cookie } });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return res;
  };
  const csrf = (await (await call("/api/auth/csrf")).json()).csrf_token;
  const res = await call("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(res.status, 200, `login ${username}: ${res.status}`);
  const me = await res.json();
  const put = async (path, body) =>
    call(path, { method: "PUT", headers: { "content-type": "application/json", "x-csrf-token": me.csrf_token }, body: JSON.stringify(body) });
  return { session: cookie.split("=").slice(1).join("="), me, put };
}

async function browser() {
  const dir = mkdtempSync(join(tmpdir(), "ttk-e2e-"));
  const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      if (list.some((t) => t.type === "page")) break;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  return {
    async tab(session, width = 1440) {
      const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((r) => ws.addEventListener("open", r));
      let id = 0;
      const pending = new Map();
      ws.addEventListener("message", (e) => {
        const m = JSON.parse(e.data);
        if (m.id && pending.has(m.id)) {
          pending.get(m.id)(m);
          pending.delete(m.id);
        }
      });
      const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
      await send("Page.enable");
      await send("Runtime.enable");
      await send("Network.enable");
      await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 640 });
      await send("Network.setCookie", { name: "ttk_session", value: session, url: `${BASE}/`, httpOnly: true });
      const ev = async (expr) => {
        const r = await send("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
        if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
        return r.result?.result?.value;
      };
      const waitFor = async (expr, ms = 15000) => {
        for (let t = 0; t < ms; t += 250) {
          if (await ev(`return !!(${expr})`)) return;
          await sleep(250);
        }
        throw new Error(`timed out waiting for ${expr}`);
      };
      return {
        ev,
        waitFor,
        async go(path) {
          await send("Page.navigate", { url: BASE + path });
          await waitFor("document.querySelector('h1')");
          await sleep(800);
        },
        async reload() {
          await send("Page.reload");
          await sleep(500);
          await waitFor("document.querySelector('h1')");
          await sleep(800);
        },
        h1: () => ev("return document.querySelector('h1')?.innerText"),
        close: () => ws.close(),
      };
    },
    async close() {
      const exited = new Promise((r) => proc.once("exit", r));
      proc.kill();
      await exited;
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

const PAGES = [
  ["/people/salary", "Salary report"],
  ["/people/payments", "Payment reports"],
  ["/people/employees", "Employees"],
  ["/attendance/mark", "Mark attendance"],
];

async function main() {
  const admin = await apiLogin(creds("E2E_ADMIN"));
  const staff = await apiLogin(creds("E2E_STAFF"));
  const branches = admin.me.branches ?? [];
  assert.ok(branches.length >= 2, "the admin needs see_other_branches and two active branches");
  const original = admin.me.active_branch.id;
  const [first, second] = branches;
  await admin.put("/api/me/active-branch", { branch_id: first.id });

  const chrome = await browser();
  const results = [];
  const step = async (name, fn) => {
    await fn();
    results.push(name);
    console.log(`ok - ${name}`);
  };
  try {
    const a = await chrome.tab(admin.session);
    const b = await chrome.tab(admin.session);
    await a.go("/");
    await b.go("/people/payments");
    assert.equal(await a.h1(), `Dashboard · ${first.name}`);

    await step("switch on the dashboard -> every page opens on that branch", async () => {
      await a.ev(`[...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.startsWith(${JSON.stringify(second.name)})).click(); return 1`);
      await a.waitFor(`document.querySelector('h1')?.innerText === ${JSON.stringify(`Dashboard · ${second.name}`)}`);
      for (const [path, title] of PAGES) {
        await a.go(path);
        assert.equal(await a.h1(), `${title} · ${second.name}`, path);
      }
    });

    await step("the switch survives a reload and reaches a second tab", async () => {
      await a.reload();
      assert.equal(await a.h1(), `Mark attendance · ${second.name}`);
      await b.waitFor(`document.querySelector('h1')?.innerText === ${JSON.stringify(`Payment reports · ${second.name}`)}`);
    });

    await step("?branch= is applied once and removed from the URL", async () => {
      await a.go(`/people/employees?branch=${first.id}`);
      await a.waitFor(`document.querySelector('h1')?.innerText === ${JSON.stringify(`Employees · ${first.name}`)}`);
      await a.waitFor("!location.search.includes('branch=')");
      await a.go("/people/salary");
      assert.equal(await a.h1(), `Salary report · ${first.name}`);
    });

    await step('"Compare branches" does not change the active branch, "Open" does', async () => {
      await a.go("/?view=compare");
      await a.waitFor("document.querySelectorAll('[data-testid=compare-grid] section').length >= 2");
      const me = await a.ev("return (await (await fetch('/api/auth/me')).json()).active_branch.id");
      assert.equal(me, first.id);
      await a.ev(`document.querySelector('[data-testid=open-${second.id}]').click(); return 1`);
      await a.waitFor(`document.querySelector('h1')?.innerText === ${JSON.stringify(`Dashboard · ${second.name}`)}`);
      assert.equal(await a.ev("return location.search"), "");
      assert.equal(await a.ev("return (await (await fetch('/api/auth/me')).json()).active_branch.id"), second.id);
    });

    await step("staff see no tabs and no switcher menu", async () => {
      const s = await chrome.tab(staff.session);
      await s.go("/");
      assert.equal(await s.ev("return document.querySelectorAll('[role=tab]').length"), 0);
      assert.equal(await s.ev("return document.querySelectorAll('[data-testid=branch-switcher], [aria-haspopup=listbox]').length"), 0);
      assert.ok(await s.ev("return !!document.querySelector('[data-testid=branch-name]')"));
      s.close();
    });
    a.close();
    b.close();
  } finally {
    await chrome.close();
    await admin.put("/api/me/active-branch", { branch_id: original });
  }
  console.log(`\n${results.length} passed`);
}

main().catch((err) => {
  console.error(`not ok - ${err.message}`);
  process.exit(1);
});
