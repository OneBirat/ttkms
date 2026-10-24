/**
 * Minimal QR code encoder (ISO/IEC 18004): byte mode, error correction M,
 * versions 1–10 (up to 213 bytes), automatic mask selection. Pure, no
 * dependencies; renders through <QrCode> as SVG. Written for the phone photo
 * link, which is short; longer payloads throw.
 */

export type QrMatrix = boolean[][];

// Per version 1..10 at level M: [ecPerBlock, blocks1, data1, blocks2, data2]
const EC_M: [number, number, number, number, number][] = [
  [10, 1, 16, 0, 0],
  [16, 1, 28, 0, 0],
  [26, 1, 44, 0, 0],
  [18, 2, 32, 0, 0],
  [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0],
  [18, 4, 31, 0, 0],
  [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37],
  [26, 4, 43, 1, 44],
];

const ALIGNMENT: number[][] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

// ------------------------------------------------------------ GF(256)

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function generatorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Reed-Solomon error-correction codewords for one block. */
export function rsEncode(data: number[], ecCount: number): number[] {
  const gen = generatorPoly(ecCount);
  const out = new Array<number>(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ out[0];
    out.shift();
    out.push(0);
    if (factor !== 0) {
      for (let i = 0; i < ecCount; i += 1) out[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return out;
}

// ------------------------------------------------------------ bits

class BitBuffer {
  bits: number[] = [];
  put(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) this.bits.push((value >>> i) & 1);
  }
  get length(): number {
    return this.bits.length;
  }
}

function dataCapacity(version: number): number {
  const [, b1, d1, b2, d2] = EC_M[version - 1];
  return b1 * d1 + b2 * d2;
}

function chooseVersion(byteLength: number): number {
  for (let version = 1; version <= 10; version += 1) {
    const countBits = version < 10 ? 8 : 16;
    const needed = 4 + countBits + byteLength * 8;
    if (needed <= dataCapacity(version) * 8) return version;
  }
  throw new Error("QR payload too long (max 213 bytes at version 10-M).");
}

function utf8Bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

function buildCodewords(bytes: number[], version: number): number[] {
  const capacity = dataCapacity(version);
  const buffer = new BitBuffer();
  buffer.put(0b0100, 4);
  buffer.put(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) buffer.put(byte, 8);
  const terminator = Math.min(4, capacity * 8 - buffer.length);
  buffer.put(0, terminator);
  while (buffer.length % 8 !== 0) buffer.put(0, 1);
  const data: number[] = [];
  for (let i = 0; i < buffer.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | buffer.bits[i + j];
    data.push(value);
  }
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad);

  const [ecPerBlock, blocks1, data1, blocks2, data2] = EC_M[version - 1];
  const blocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (let i = 0; i < blocks1 + blocks2; i += 1) {
    const size = i < blocks1 ? data1 : data2;
    const block = data.slice(offset, offset + size);
    offset += size;
    blocks.push(block);
    ecBlocks.push(rsEncode(block, ecPerBlock));
  }
  const out: number[] = [];
  const longest = Math.max(data1, data2);
  for (let i = 0; i < longest; i += 1) {
    for (const block of blocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return out;
}

// ------------------------------------------------------------ matrix

type Reserved = boolean[][];

function makeGrid(size: number): QrMatrix {
  return Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
}

function placeFinder(matrix: QrMatrix, reserved: Reserved, row: number, col: number): void {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || cc < 0 || rr >= matrix.length || cc >= matrix.length) continue;
      const inner = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const dark =
        inner &&
        (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      matrix[rr][cc] = dark;
      reserved[rr][cc] = true;
    }
  }
}

function placeAlignment(matrix: QrMatrix, reserved: Reserved, row: number, col: number): void {
  for (let r = -2; r <= 2; r += 1) {
    for (let c = -2; c <= 2; c += 1) {
      const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
      matrix[row + r][col + c] = dark;
      reserved[row + r][col + c] = true;
    }
  }
}

function bchRemainder(value: number, poly: number, polyBits: number, totalBits: number): number {
  let v = value << (polyBits - 1);
  for (let i = totalBits - 1; i >= polyBits - 1; i -= 1) {
    if (v & (1 << i)) v ^= poly << (i - (polyBits - 1));
  }
  return v;
}

/** 15-bit format information for level M and `mask` (0–7). */
export function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask; // level M = 00
  const bits = (data << 10) | bchRemainder(data, 0b10100110111, 11, 15);
  return bits ^ 0b101010000010010;
}

/** 18-bit version information (versions 7+). */
export function versionBits(version: number): number {
  return (version << 12) | bchRemainder(version, 0b1111100100101, 13, 18);
}

function placeFormat(matrix: QrMatrix, reserved: Reserved, mask: number): void {
  const size = matrix.length;
  const bits = formatBits(mask);
  for (let i = 0; i < 15; i += 1) {
    const bit = ((bits >>> i) & 1) === 1;
    // Around the top-left finder.
    const r1 = i < 6 ? i : i < 8 ? i + 1 : 8;
    const c1 = i < 8 ? 8 : i === 8 ? 7 : 14 - i;
    matrix[r1][c1] = bit;
    reserved[r1][c1] = true;
    // Second copy: under the top-right finder and right of the bottom-left one.
    const r2 = i < 8 ? 8 : size - 15 + i;
    const c2 = i < 8 ? size - 1 - i : 8;
    matrix[r2][c2] = bit;
    reserved[r2][c2] = true;
  }
  matrix[size - 8][8] = true; // dark module
  reserved[size - 8][8] = true;
}

function placeVersion(matrix: QrMatrix, reserved: Reserved, version: number): void {
  if (version < 7) return;
  const size = matrix.length;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i += 1) {
    const bit = ((bits >>> i) & 1) === 1;
    const a = Math.floor(i / 3);
    const b = size - 11 + (i % 3);
    matrix[b][a] = bit;
    matrix[a][b] = bit;
    reserved[b][a] = true;
    reserved[a][b] = true;
  }
}

function placeFunctionPatterns(version: number): { matrix: QrMatrix; reserved: Reserved } {
  const size = version * 4 + 17;
  const matrix = makeGrid(size);
  const reserved = makeGrid(size);
  placeFinder(matrix, reserved, 0, 0);
  placeFinder(matrix, reserved, 0, size - 7);
  placeFinder(matrix, reserved, size - 7, 0);
  const positions = ALIGNMENT[version - 1];
  for (const row of positions) {
    for (const col of positions) {
      if (reserved[row][col]) continue; // overlaps a finder
      placeAlignment(matrix, reserved, row, col);
    }
  }
  for (let i = 8; i < size - 8; i += 1) {
    if (!reserved[6][i]) {
      matrix[6][i] = i % 2 === 0;
      reserved[6][i] = true;
    }
    if (!reserved[i][6]) {
      matrix[i][6] = i % 2 === 0;
      reserved[i][6] = true;
    }
  }
  // Reserve the format and version areas before data is placed.
  placeFormat(matrix, reserved, 0);
  placeVersion(matrix, reserved, version);
  return { matrix, reserved };
}

/** Module coordinates in data-placement order (zigzag from the bottom right). */
export function dataPath(size: number, reserved: Reserved): [number, number][] {
  const path: [number, number][] = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (!reserved[row][col]) path.push([row, col]);
      }
    }
    upward = !upward;
  }
  return path;
}

export function maskBit(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

function penalty(matrix: QrMatrix): number {
  const size = matrix.length;
  let score = 0;
  // Rule 1: runs of 5+ same-colour modules in a row/column.
  for (let i = 0; i < size; i += 1) {
    let runRow = 1;
    let runCol = 1;
    for (let j = 1; j < size; j += 1) {
      if (matrix[i][j] === matrix[i][j - 1]) {
        runRow += 1;
        if (runRow === 5) score += 3;
        else if (runRow > 5) score += 1;
      } else runRow = 1;
      if (matrix[j][i] === matrix[j - 1][i]) {
        runCol += 1;
        if (runCol === 5) score += 3;
        else if (runCol > 5) score += 1;
      } else runCol = 1;
    }
  }
  // Rule 2: 2x2 blocks.
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = matrix[r][c];
      if (v === matrix[r][c + 1] && v === matrix[r + 1][c] && v === matrix[r + 1][c + 1]) score += 3;
    }
  }
  // Rule 3: finder-like patterns 1011101 with 4 light modules on a side.
  const pattern = [true, false, true, true, true, false, true];
  const hasPattern = (get: (k: number) => boolean | undefined) => {
    for (let k = 0; k < 7; k += 1) if (get(k) !== pattern[k]) return false;
    const before = [0, 1, 2, 3].every((k) => get(-1 - k) === false);
    const after = [0, 1, 2, 3].every((k) => get(7 + k) === false);
    return before || after;
  };
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (hasPattern((k) => matrix[r][c + k])) score += 40;
      if (hasPattern((k) => matrix[r + k]?.[c])) score += 40;
    }
  }
  // Rule 4: dark-module ratio.
  let dark = 0;
  for (const row of matrix) for (const cell of row) if (cell) dark += 1;
  const percent = (dark * 100) / (size * size);
  const lower = Math.floor(percent / 5) * 5;
  score += (Math.min(Math.abs(lower - 50), Math.abs(lower + 5 - 50)) / 5) * 10;
  return score;
}

export interface QrResult {
  version: number;
  mask: number;
  size: number;
  modules: QrMatrix;
}

/** Encode `text` (UTF-8, byte mode, level M) into a module matrix. */
export function encodeQr(text: string): QrResult {
  const bytes = utf8Bytes(text);
  const version = chooseVersion(bytes.length);
  const codewords = buildCodewords(bytes, version);
  const { matrix: base, reserved } = placeFunctionPatterns(version);
  const size = base.length;
  const path = dataPath(size, reserved);

  let best: QrResult | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask += 1) {
    const matrix = base.map((row) => [...row]);
    path.forEach(([row, col], index) => {
      const byte = codewords[index >> 3] ?? 0;
      const bit = ((byte >>> (7 - (index & 7))) & 1) === 1;
      matrix[row][col] = bit !== maskBit(mask, row, col);
    });
    placeFormat(matrix, reserved.map((row) => [...row]), mask);
    const score = penalty(matrix);
    if (score < bestScore) {
      bestScore = score;
      best = { version, mask, size, modules: matrix };
    }
  }
  return best!;
}

/** SVG path data ("M0 0h1v1h-1z…") for the dark modules, 1 unit per module. */
export function qrPath(modules: QrMatrix): string {
  const parts: string[] = [];
  modules.forEach((row, r) => {
    let start = -1;
    for (let c = 0; c <= row.length; c += 1) {
      const dark = c < row.length && row[c];
      if (dark && start === -1) start = c;
      if (!dark && start !== -1) {
        parts.push(`M${start} ${r}h${c - start}v1h-${c - start}z`);
        start = -1;
      }
    }
  });
  return parts.join("");
}

/** Codewords for `text` (exported for tests). */
export function codewordsFor(text: string): { version: number; codewords: number[] } {
  const bytes = utf8Bytes(text);
  const version = chooseVersion(bytes.length);
  return { version, codewords: buildCodewords(bytes, version) };
}

/** Function-pattern layout for `version` (exported for tests). */
export function layoutFor(version: number): { matrix: QrMatrix; reserved: Reserved } {
  return placeFunctionPatterns(version);
}

export function gfPolyEval(poly: number[], x: number): number {
  let y = 0;
  for (const coefficient of poly) y = gfMul(y, x) ^ coefficient;
  return y;
}
