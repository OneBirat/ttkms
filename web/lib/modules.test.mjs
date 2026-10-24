// Run with `npm test` (node --experimental-strip-types --test).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  enabledOnly,
  homePath,
  isPublicPath,
  moduleForPath,
  modulesFromNav,
} from "./modules.ts";

const NAV = [
  {
    module: "attendance",
    title: "Attendance",
    items: [
      { label: "Mark attendance", path: "/attendance/mark", icon: "check" },
      { label: "Attendance report", path: "/attendance/report", icon: "calendar" },
    ],
  },
  {
    module: "payroll",
    title: "People & payroll",
    items: [
      { label: "Employees", path: "/people/employees", icon: "users" },
      { label: "Salary report", path: "/people/salary", icon: "banknote" },
      { label: "Payments", path: "/people/payments", icon: "list" },
    ],
  },
  {
    module: "admin",
    title: "Admin",
    items: [
      { label: "Users", path: "/admin/users", icon: "user" },
      { label: "Barcodes", path: "/admin/barcodes", icon: "barcode" },
      { label: "Payment modes", path: "/admin/payment-modes", icon: "card" },
    ],
  },
];

const NAV_WITHOUT_PAYROLL = NAV.filter((section) => section.module !== "payroll");

test("moduleForPath maps every module prefix and nothing else", () => {
  assert.equal(moduleForPath("/attendance"), "attendance");
  assert.equal(moduleForPath("/attendance/mark"), "attendance");
  assert.equal(moduleForPath("/attendance/report?x=1".split("?")[0]), "attendance");
  assert.equal(moduleForPath("/people"), "payroll");
  assert.equal(moduleForPath("/people/employees"), "payroll");
  assert.equal(moduleForPath("/people/employees/12"), "payroll");
  assert.equal(moduleForPath("/people/salary"), "payroll");
  assert.equal(moduleForPath("/people/payments"), "payroll");
  assert.equal(moduleForPath("/people/photo/abc"), "payroll");
  assert.equal(moduleForPath("/payroll"), null, "payroll pages live under /people");
  assert.equal(moduleForPath("/peoples"), null);
  assert.equal(moduleForPath("/admin"), "admin");
  assert.equal(moduleForPath("/admin/users"), "admin");
  assert.equal(moduleForPath("/admin/barcodes"), "admin");
  assert.equal(moduleForPath("/stock"), null);
  assert.equal(moduleForPath("/admin/products"), "admin");
  assert.equal(moduleForPath("/attendancexyz"), null);
  assert.equal(moduleForPath("/"), null);
  assert.equal(moduleForPath("/module-off"), null);
});

test("only the token photo page is public", () => {
  assert.ok(isPublicPath("/people/photo/abc123"));
  assert.ok(isPublicPath("/people/photo"));
  assert.ok(!isPublicPath("/people/photos"));
  assert.ok(!isPublicPath("/people/employees"));
  assert.ok(!isPublicPath("/"));
  assert.ok(!isPublicPath("/attendance/mark"));
});

test("sidebar sections come from the nav, in order", () => {
  const modules = modulesFromNav(NAV);
  assert.deepEqual(
    modules.map((m) => m.name),
    ["attendance", "payroll", "admin"],
  );
  assert.ok(modules.every((m) => m.allowed));
  const paths = modules.flatMap((m) => m.nav.map((item) => item.path));
  assert.ok(paths.includes("/people/employees") && paths.includes("/admin/users"));
  assert.ok(paths.every((p) => !p.startsWith("/stock")));
  assert.deepEqual(
    modulesFromNav(NAV_WITHOUT_PAYROLL).map((m) => m.name),
    ["attendance", "admin"],
  );
});

test("after login users land on the first link they may see", () => {
  assert.equal(homePath(NAV), "/attendance/mark");
  assert.equal(homePath(NAV.slice(1)), "/people/employees");
  assert.equal(homePath([]), "/");
  assert.equal(homePath([{ module: "x", title: "X", items: [] }]), "/");
});

test("dashboard widgets of a disabled module are dropped", () => {
  const widgets = [
    { module: "payroll", kind: "payments_today", title: "Payments today", data: {} },
    { module: "attendance", kind: "attendance_today", title: "Attendance today", data: {} },
  ];
  const shown = enabledOnly(widgets, ["attendance", "admin"]);
  assert.deepEqual(
    shown.map((w) => w.kind),
    ["attendance_today"],
  );
  assert.equal(enabledOnly(widgets, ["attendance", "payroll"]).length, 2);
});
