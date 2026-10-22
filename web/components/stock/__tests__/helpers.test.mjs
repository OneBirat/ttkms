import { test } from "node:test";
import assert from "node:assert/strict";
import {
  statusFor,
  normalizeName,
  findDuplicateProduct,
  isDuplicateVariation,
  variationCode,
  matchesSearch,
  filterProducts,
  averagePerOpenDay,
  daysLeft,
  isMonthBoundary,
  groupByBsMonth,
  percentChange,
  signed,
} from "../helpers.ts";

test("statusFor: Out at 0, Low at or below reorder, OK above", () => {
  assert.equal(statusFor(0, 5), "out");
  assert.equal(statusFor(5, 5), "low");
  assert.equal(statusFor(3, 5), "low");
  assert.equal(statusFor(6, 5), "ok");
  assert.equal(statusFor(-1, 5), "out");
});

test("normalizeName ignores case and every whitespace", () => {
  assert.equal(normalizeName(" SS  Black\tCooker "), "ssblackcooker");
});

test("findDuplicateProduct matches ignoring case and spaces, skips ignoreId", () => {
  const products = [
    { id: 1, name: "SS Black cooker" },
    { id: 2, name: "Rice cooker" },
  ];
  assert.equal(findDuplicateProduct(products, "ssblack COOKER")?.id, 1);
  assert.equal(findDuplicateProduct(products, "Pressure pan"), null);
  assert.equal(findDuplicateProduct(products, "rice cooker", 2), null);
  assert.equal(findDuplicateProduct(products, "   "), null);
});

test("isDuplicateVariation within a product", () => {
  assert.equal(isDuplicateVariation(["2.5 L", "3 L"], "3l"), true);
  assert.equal(isDuplicateVariation(["2.5 L", "3 L"], "5 L"), false);
  assert.equal(isDuplicateVariation(["2.5 L"], ""), false);
});

test("variationCode builds initials plus a cleaned suffix", () => {
  assert.equal(variationCode("SS Black cooker", "3 L"), "SBC-3L");
  assert.equal(variationCode("Steel kadhai", "26 cm"), "SK-26CM");
  assert.equal(variationCode("Cooker gasket", "2–3 L"), "CG-23L");
  assert.equal(variationCode("Rice cooker", "1.8 L"), "RC-1.8L");
});

test("matchesSearch requires every word across product and variation", () => {
  assert.equal(matchesSearch("cooker 3", "SS Black cooker", "3 L"), true);
  assert.equal(matchesSearch("cooker 3", "SS Black cooker", "5 L"), false);
  assert.equal(matchesSearch("", "x", "y"), true);
});

test("filterProducts drops products without matching variations", () => {
  const products = [
    { id: 1, name: "SS Black cooker", variations: [{ name: "3 L" }, { name: "5 L" }] },
    { id: 2, name: "Steel kadhai", variations: [{ name: "26 cm" }] },
  ];
  const result = filterProducts(products, "cooker 3");
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].variations.map((v) => v.name), ["3 L"]);
});

test("averagePerOpenDay excludes Saturdays", () => {
  const rows = [
    { weekday: 5, sold: 4 },
    { weekday: 6, sold: 0 },
    { weekday: 0, sold: 2 },
  ];
  assert.equal(averagePerOpenDay(rows), 3);
  assert.equal(averagePerOpenDay([{ weekday: 6, sold: 0 }]), 0);
});

test("daysLeft rounds and is null without a pace", () => {
  assert.equal(daysLeft(10, 1.5), 7);
  assert.equal(daysLeft(10, 0), null);
});

test("BS month grouping and boundaries", () => {
  const rows = [
    { date_bs: "2083-07-02" },
    { date_bs: "2083-07-01" },
    { date_bs: "2083-06-30" },
  ];
  assert.equal(isMonthBoundary(rows, 0), false);
  assert.equal(isMonthBoundary(rows, 1), true);
  assert.equal(isMonthBoundary(rows, 2), false);
  assert.deepEqual([...groupByBsMonth(rows).keys()], ["2083-07", "2083-06"]);
});

test("percentChange and signed cells", () => {
  assert.equal(percentChange(20, 25), 25);
  assert.equal(percentChange(0, 25), null);
  assert.equal(signed(6, "+"), "+6");
  assert.equal(signed(0, "−"), "–");
});
