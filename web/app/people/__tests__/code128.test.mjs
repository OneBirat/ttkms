import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CODE128_PATTERNS,
  START_B,
  START_C,
  STOP,
  code128Bars,
  code128Symbols,
  encodeCode128,
} from "../_lib/code128.ts";

test("pattern table: 107 symbols, 11 modules each (stop 13), even number of bar modules", () => {
  assert.equal(CODE128_PATTERNS.length, 107);
  CODE128_PATTERNS.forEach((p, i) => {
    const widths = [...p].map(Number);
    const total = widths.reduce((a, b) => a + b, 0);
    assert.equal(total, i === STOP ? 13 : 11, `symbol ${i}`);
    const bars = widths.filter((_, k) => k % 2 === 0).reduce((a, b) => a + b, 0);
    assert.equal(bars % 2, 0, `symbol ${i} bar parity`);
  });
});

test("TTK-E001 encodes in subset B with the right checksum", () => {
  const symbols = code128Symbols("TTK-E001");
  // Start B, T T K - E 0 0 1, checksum, stop
  assert.equal(symbols[0], START_B);
  assert.deepEqual(symbols.slice(1, 9), [52, 52, 43, 13, 37, 16, 16, 17]);
  const expected = (START_B + 52 * 1 + 52 * 2 + 43 * 3 + 13 * 4 + 37 * 5 + 16 * 6 + 16 * 7 + 17 * 8) % 103;
  assert.equal(symbols[9], expected);
  assert.equal(symbols[10], STOP);
  assert.equal(symbols.length, 11);
});

test("long digit runs switch to subset C", () => {
  const symbols = code128Symbols("12345678");
  assert.equal(symbols[0], START_C);
  assert.deepEqual(symbols.slice(1, 5), [12, 34, 56, 78]);
  assert.equal(symbols[symbols.length - 1], STOP);
});

test("encoded width = 11 × symbols + 2 (stop), bars start at x=0", () => {
  const code = encodeCode128("TTK-E001");
  assert.equal(code.modules, 11 * 11 + 2);
  const bars = code128Bars(code.widths);
  assert.equal(bars[0].x, 0);
  assert.equal(bars[0].width, 2);
  assert.equal(bars.at(-1).x + bars.at(-1).width, code.modules);
});

test("unencodable characters throw", () => {
  assert.throws(() => code128Symbols("TTK\u0007"));
  assert.throws(() => code128Symbols(""));
});
