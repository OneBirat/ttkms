import { test } from "node:test";
import assert from "node:assert/strict";
import { code128, code128Values, stickerText } from "../../../web/components/admin/code128.ts";

test("values: start B, characters, checksum, stop", () => {
  const values = code128Values("TTK-E-001");
  const chars = [..."TTK-E-001"].map((c) => c.charCodeAt(0) - 32);
  assert.equal(values[0], 104);
  assert.deepEqual(values.slice(1, -2), chars);
  assert.equal(values[values.length - 1], 106);
  const checksum = (104 + chars.reduce((sum, v, i) => sum + v * (i + 1), 0)) % 103;
  assert.equal(values[values.length - 2], checksum);
  assert.throws(() => code128Values(""));
  assert.throws(() => code128Values("नाम"));
});

test("bars: 11 modules per symbol, 13 for stop, quiet zones of 10", () => {
  const code = code128("TTK-E-001");
  const symbols = code128Values("TTK-E-001").length;
  assert.equal(code.width, 10 + 11 * (symbols - 1) + 13 + 10);
  assert.equal(code.bars[0].x, 10);
  let last = 0;
  for (const bar of code.bars) {
    assert.ok(bar.x >= last && bar.width >= 1 && bar.width <= 4);
    last = bar.x + bar.width;
  }
  assert.equal(last, code.width - 10);
  assert.equal(stickerText("E-007"), "TTK-E-007");
});
