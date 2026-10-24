import { test } from "node:test";
import assert from "node:assert/strict";
import {
  codewordsFor,
  dataPath,
  encodeQr,
  formatBits,
  gfPolyEval,
  layoutFor,
  maskBit,
  qrPath,
  rsEncode,
  versionBits,
} from "../_lib/qr.ts";

const URL = "http://192.168.1.23:3003/payroll/photo/0123456789abcdef0123456789abcdef";

test("Reed-Solomon: known generator check and zero syndromes", () => {
  // From the QR spec worked example: "HELLO WORLD" 1-M data codewords.
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  const ec = rsEncode(data, 10);
  assert.deepEqual(ec, [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  // Every codeword polynomial is divisible by the generator: syndromes vanish.
  const exp = (n) => { let x = 1; for (let i = 0; i < n; i++) { x <<= 1; if (x & 0x100) x ^= 0x11d; } return x; };
  for (let i = 0; i < 10; i += 1) assert.equal(gfPolyEval([...data, ...ec], exp(i)), 0);
});

test("format and version information carry a valid BCH code", () => {
  // Known value: level M, mask 0 -> 101010000010010 (the XOR mask itself).
  assert.equal(formatBits(0), 0b101010000010010);
  // Level M, mask 2 from the spec tables.
  assert.equal(formatBits(2), 0b101111001111100);
  assert.equal(versionBits(7), 0b000111110010010100);
  assert.equal(versionBits(10), 0b001010010011010011);
});

test("version choice, size and codeword count", () => {
  const { version, codewords } = codewordsFor(URL);
  assert.equal(version, 5); // 68 bytes fit 5-M (86 data codewords)
  assert.equal(codewords.length, 134);
  assert.equal(codewordsFor("x").version, 1);
  assert.equal(codewordsFor("x".repeat(213)).version, 10);
  assert.throws(() => codewordsFor("x".repeat(214)));
});

test("function patterns: finders, timing, alignment, reserved areas", () => {
  const { matrix, reserved } = layoutFor(5);
  const size = matrix.length;
  assert.equal(size, 37);
  // Finder centres are dark, separators light.
  assert.equal(matrix[3][3], true);
  assert.equal(matrix[7][7], false);
  assert.equal(matrix[3][size - 4], true);
  assert.equal(matrix[size - 4][3], true);
  // Timing pattern alternates starting dark at (6, 8).
  assert.equal(matrix[6][8], true);
  assert.equal(matrix[6][9], false);
  assert.equal(matrix[8][6], true);
  // Alignment pattern at (30, 30) for version 5.
  assert.equal(matrix[30][30], true);
  assert.equal(matrix[29][30], false);
  assert.equal(matrix[28][30], true);
  // Dark module.
  assert.equal(matrix[size - 8][8], true);
  // Data path covers every unreserved module exactly once.
  const path = dataPath(size, reserved);
  const free = reserved.flat().filter((r) => !r).length;
  assert.equal(path.length, free);
  assert.equal(new Set(path.map(([r, c]) => `${r},${c}`)).size, free);
  // Capacity: 134 codewords + 7 remainder bits for version 5.
  assert.equal(free, 134 * 8 + 7);
});

test("encodeQr round-trips the codewords through placement and masking", () => {
  const result = encodeQr(URL);
  assert.equal(result.size, 37);
  const { codewords } = codewordsFor(URL);
  const { reserved } = layoutFor(result.version);
  const path = dataPath(result.size, reserved);
  const bits = path.map(([r, c]) => (result.modules[r][c] !== maskBit(result.mask, r, c) ? 1 : 0));
  const bytes = [];
  for (let i = 0; i + 8 <= codewords.length * 8; i += 8) {
    bytes.push(bits.slice(i, i + 8).reduce((v, b) => (v << 1) | b, 0));
  }
  assert.deepEqual(bytes, codewords);
  // Format info in the matrix matches the chosen mask (both copies).
  const expected = formatBits(result.mask);
  const size = result.size;
  for (let i = 0; i < 15; i += 1) {
    const bit = ((expected >>> i) & 1) === 1;
    const r1 = i < 6 ? i : i < 8 ? i + 1 : 8;
    const c1 = i < 8 ? 8 : i === 8 ? 7 : 14 - i;
    assert.equal(result.modules[r1][c1], bit, `format copy 1 bit ${i}`);
    const r2 = i < 8 ? 8 : size - 15 + i;
    const c2 = i < 8 ? size - 1 - i : 8;
    assert.equal(result.modules[r2][c2], bit, `format copy 2 bit ${i}`);
  }
  assert.ok(qrPath(result.modules).startsWith("M0 0h7v1h-7z"));
});

test("version 7+ places version information", () => {
  const result = encodeQr("x".repeat(120));
  assert.equal(result.version, 7);
  const bits = versionBits(7);
  for (let i = 0; i < 18; i += 1) {
    const bit = ((bits >>> i) & 1) === 1;
    const a = Math.floor(i / 3);
    const b = result.size - 11 + (i % 3);
    assert.equal(result.modules[b][a], bit);
    assert.equal(result.modules[a][b], bit);
  }
});
