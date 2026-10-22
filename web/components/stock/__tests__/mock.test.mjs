import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  resetMockState,
  readProducts,
  readProduct,
  readReport,
  readDailyHistory,
  readProductStats,
  readLowStock,
  readCurrentStock,
  readTodayEntries,
  readItems,
  writeProduct,
  writeEntry,
  patchVariation,
  mockToday,
} from "../mockData.ts";
import { adToBs, formatBsIso, addDays } from "../calendar.ts";
import { StockApiError } from "../types.ts";

const NOW = new Date(2026, 9, 23, 11, 0, 0); // 23 Oct 2026 = Kartik 7, 2083

beforeEach(() => resetMockState(NOW));

test("catalogue: 12 products, every variation has a code and a consistent status", () => {
  const { products, summary } = readProducts();
  assert.equal(products.length, 12);
  assert.equal(summary.products, 12);
  for (const p of products) {
    for (const v of p.variations) {
      assert.ok(v.code.includes("-"), v.code);
      assert.ok(v.in_stock >= 0, `${p.name} ${v.name} negative stock`);
      const expected = v.in_stock === 0 ? "out" : v.in_stock <= v.reorder_level ? "low" : "ok";
      assert.equal(v.status, expected);
    }
  }
  assert.ok(summary.out >= 1, "the design story needs an out-of-stock item");
  assert.ok(summary.low >= 3);
});

test("running balance never goes negative in the daily history", () => {
  const { products } = readProducts();
  for (const p of products) {
    const history = readDailyHistory(p.id, null, 200);
    for (const row of history.rows) assert.ok(row.closing >= 0, `${p.name} ${row.date_bs}`);
    assert.equal(history.rows[0].closing, p.variations.reduce((a, v) => a + v.in_stock, 0));
  }
});

test("there are entries today and the report totals add up", () => {
  const today_ = readTodayEntries(null);
  assert.ok(today_.purchases.count + today_.consumptions.count > 0);
  const today = formatBsIso(adToBs(mockToday()));
  const from = formatBsIso(adToBs(addDays(mockToday(), -6)));
  const report = readReport({
    from_bs: from,
    to_bs: today,
    product_id: null,
    variation_id: null,
    type: null,
    page: 1,
    page_size: 20,
  });
  const t = report.totals;
  assert.equal(t.stock_at_end, t.stock_at_start + t.opening + t.purchased - t.consumed);
  assert.equal(t.stock_at_end, readProducts().summary.total_pcs);
  assert.ok(report.pages >= 1);
  assert.ok(report.rows.length <= 20);
  // newest first
  for (let i = 1; i < report.rows.length; i++) {
    assert.ok(report.rows[i - 1].date_ad >= report.rows[i].date_ad);
  }
});

test("writeProduct rejects duplicates ignoring case and spaces", () => {
  const request = {
    name: "ss black COOKER",
    variations_by: "Capacity",
    unit: "pcs",
    opening_date_bs: "2083-07-07",
    variations: [{ name: "2 L", opening: 1, reorder_level: 5 }],
  };
  assert.throws(() => writeProduct(request), (e) => e instanceof StockApiError && e.status === 409);
  const created = writeProduct({ ...request, name: "Pressure pan" });
  assert.equal(created.variations.length, 1);
  assert.equal(created.variations[0].in_stock, 1);
  assert.equal(readProducts().products.length, 13);
  assert.throws(
    () =>
      writeProduct({
        ...request,
        name: "Idli maker",
        variations: [
          { name: "3 L", opening: 0, reorder_level: 5 },
          { name: "3l", opening: 0, reorder_level: 5 },
        ],
      }),
    (e) => e.status === 422,
  );
});

test("writeEntry saves all rows or none, reports today's totals and updates stock", () => {
  const product = readProduct(1);
  const v = product.variations[0];
  const before = v.in_stock;
  const todayAd = mockToday();
  const today = formatBsIso(adToBs(todayAd));
  const purchasesBefore = readTodayEntries("purchase").purchases;
  const result = writeEntry({
    type: "purchase",
    date_bs: today,
    date_ad: todayAd,
    rows: [{ variation_id: v.id, qty: 5, remark: " Sharma Traders " }],
  });
  assert.equal(result.saved.length, 1);
  assert.equal(result.saved[0].remarks, "Sharma Traders");
  assert.equal(result.saved[0].type, "purchase");
  assert.equal(result.today.count, purchasesBefore.count + 1);
  assert.equal(result.today.total_quantity, purchasesBefore.total_quantity + 5);
  assert.equal(readProduct(1).variations[0].in_stock, before + 5);
  // The saved row is first in today's list.
  assert.equal(readTodayEntries("purchase").entries[0].id, result.saved[0].id);
  assert.throws(
    () =>
      writeEntry({
        type: "consumption",
        date_bs: today,
        date_ad: todayAd,
        rows: [
          { variation_id: v.id, qty: 1, remark: null },
          { variation_id: v.id, qty: 1, remark: null },
        ],
      }),
    (e) => e.status === 422 && e.field === "rows.1",
  );
  assert.equal(readProduct(1).variations[0].in_stock, before + 5, "nothing saved on error");
  assert.throws(
    () => writeEntry({ type: "consumption", date_bs: today, date_ad: todayAd, rows: [{ variation_id: v.id, qty: 0, remark: null }] }),
    (e) => e.status === 422 && e.field === "rows.0",
  );
  assert.throws(
    () => writeEntry({ type: "purchase", date_bs: today, date_ad: todayAd, rows: [] }),
    (e) => e.status === 422,
  );
  assert.throws(
    () => writeEntry({ type: "opening", date_bs: today, date_ad: todayAd, rows: [{ variation_id: v.id, qty: 1, remark: null }] }),
    (e) => e.status === 422,
  );
  // Consumption may take stock below zero (the phone layout warns but allows it).
  const big = writeEntry({ type: "consumption", date_bs: today, date_ad: todayAd, rows: [{ variation_id: v.id, qty: before + 50, remark: null }] });
  assert.equal(big.saved.length, 1);
  assert.equal(readProduct(1).variations[0].in_stock, -45);
});

test("readTodayEntries: all types newest first, or one type; totals cover both", () => {
  const all = readTodayEntries(null);
  assert.ok(all.entries.length > 0);
  assert.ok(all.entries.every((e) => e.type !== "opening"));
  for (let i = 1; i < all.entries.length; i++) {
    assert.ok(all.entries[i - 1].id > all.entries[i].id, "newest first");
  }
  const purchases = readTodayEntries("purchase");
  assert.ok(purchases.entries.every((e) => e.type === "purchase"));
  assert.equal(purchases.entries.length, all.purchases.count);
  assert.equal(all.purchases.count + all.consumptions.count, all.entries.length);
  assert.deepEqual(purchases.purchases, all.purchases);
});

test("readItems: word search in any order, stock included, excluded ids hidden", () => {
  const everything = readItems("", []);
  assert.equal(everything.items.length, readProducts().summary.variations);
  const hits = readItems("3 cooker", []);
  assert.ok(hits.items.length > 0);
  assert.ok(hits.items.every((i) => /cooker/i.test(i.product_name) && /3/.test(`${i.product_name} ${i.variation_name}`)));
  assert.ok(hits.items.every((i) => typeof i.in_stock === "number" && i.code));
  const first = hits.items[0];
  const without = readItems("3 cooker", [first.variation_id]);
  assert.equal(without.items.length, hits.items.length - 1);
  assert.ok(without.items.every((i) => i.variation_id !== first.variation_id));
  assert.equal(readItems("zzz nothing", []).items.length, 0);
});

test("stats, low stock and current stock are consistent with the catalogue", () => {
  const stats = readProductStats(1, null);
  assert.equal(stats.weekday_sales.length, 7);
  assert.equal(stats.weekday_sales[6], 0, "Saturday is closed");
  assert.equal(stats.last_6_months.length, 6);
  assert.ok(stats.patterns.length >= 2);
  const low = readLowStock();
  assert.ok(low.rows.length >= 4);
  assert.equal(low.rows[0].status, "out", "out of stock first");
  const current = readCurrentStock("cooker 3", 1, 10);
  assert.ok(current.rows.every((r) => r.in_stock === r.opening + r.purchased - r.consumed));
  patchVariation(low.rows[0].variation_id, { reorder_level: 0 });
  assert.ok(readLowStock().rows.every((r) => r.variation_id !== low.rows[0].variation_id || r.status === "out"));
});
