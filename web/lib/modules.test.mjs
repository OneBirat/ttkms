// Run with `npm test` (node --experimental-strip-types --test).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  enabledOnly,
  homePath,
  moduleForPath,
  modulesFromNav,
} from "./modules.ts";

const NAV_WITHOUT_STOCK = [
  {
    module: "attendance",
    title: "Attendance",
    items: [{ label: "Overview", path: "/attendance", icon: "calendar" }],
  },
  {
    module: "payroll",
    title: "People & payroll",
    items: [{ label: "Overview", path: "/payroll", icon: "users" }],
  },
  {
    module: "admin",
    title: "Admin",
    items: [
      { label: "Users", path: "/admin/users", icon: "shield" },
      { label: "Barcodes", path: "/admin/barcodes", icon: "box" },
    ],
  },
];

const NAV_WITH_STOCK = [
  {
    module: "stock",
    title: "Stock",
    items: [{ label: "Stock entry", path: "/stock/entry", icon: "box" }],
  },
  ...NAV_WITHOUT_STOCK,
];

test("moduleForPath maps stock routes and Admin › Products to stock", () => {
  assert.equal(moduleForPath("/stock"), "stock");
  assert.equal(moduleForPath("/stock/entry"), "stock");
  assert.equal(moduleForPath("/stock/report?x=1".split("?")[0]), "stock");
  assert.equal(moduleForPath("/admin/products"), "stock");
  assert.equal(moduleForPath("/admin/products/12"), "stock");
  assert.equal(moduleForPath("/admin"), "admin");
  assert.equal(moduleForPath("/admin/users"), "admin");
  assert.equal(moduleForPath("/admin/barcodes"), "admin");
  assert.equal(moduleForPath("/attendance/mark"), "attendance");
  assert.equal(moduleForPath("/stockroom"), null);
  assert.equal(moduleForPath("/"), null);
  assert.equal(moduleForPath("/module-off"), null);
});

test("the sidebar sections contain no stock when stock is paused", () => {
  const modules = modulesFromNav(NAV_WITHOUT_STOCK);
  assert.deepEqual(
    modules.map((m) => m.name),
    ["attendance", "payroll", "admin"],
  );
  assert.ok(modules.every((m) => m.allowed));
  const paths = modules.flatMap((m) => m.nav.map((item) => item.path));
  assert.ok(paths.every((p) => !p.startsWith("/stock") && p !== "/admin/products"));
  assert.ok(paths.includes("/admin/users") && paths.includes("/admin/barcodes"));
});

test("after login users land on Attendance when stock is paused", () => {
  assert.equal(homePath(NAV_WITHOUT_STOCK), "/attendance");
  assert.equal(homePath(NAV_WITH_STOCK), "/stock/entry");
  assert.equal(homePath([]), "/");
  assert.equal(homePath([{ module: "x", title: "X", items: [] }]), "/");
});

test("dashboard widgets of a disabled module are dropped", () => {
  const widgets = [
    { module: "stock", kind: "stock_low", title: "Low in stock", data: {} },
    { module: "stock", kind: "stock_current", title: "Current stock", data: {} },
    { module: "attendance", kind: "attendance_today", title: "Attendance today", data: {} },
  ];
  const shown = enabledOnly(widgets, ["attendance", "payroll", "admin"]);
  assert.deepEqual(
    shown.map((w) => w.kind),
    ["attendance_today"],
  );
  assert.equal(enabledOnly(widgets, ["stock", "attendance"]).length, 3);
});
