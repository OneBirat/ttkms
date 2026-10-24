/**
 * Code 128 encoder (subset B, with subset C for runs of 4+ digits), no
 * dependencies. Produces the module widths a renderer draws as bars and
 * spaces; Barcode.tsx turns them into SVG and PNG. The employee sticker value
 * is "TTK-E001" (see helpers.barcodeFor).
 *
 * NEEDS FROM MAIN (optional): if a barcode library (bwip-js / JsBarcode) is
 * added for Admin › Barcodes, this file can be replaced by it.
 */

/** Bar/space module widths of the 107 Code 128 symbols (6 digits each; stop has 7). */
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
] as const;

export const START_B = 104;
export const START_C = 105;
export const CODE_B = 100;
export const CODE_C = 99;
export const STOP = 106;

export { PATTERNS as CODE128_PATTERNS };

/** Subset B value of a printable ASCII character (space … DEL). */
function valueB(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code < 32 || code > 126) throw new Error(`Code 128 B cannot encode "${ch}"`);
  return code - 32;
}

/** Symbol values (start … checksum, stop) for `text`. */
export function code128Symbols(text: string): number[] {
  if (!text) throw new Error("Nothing to encode");
  const out: number[] = [];
  let i = 0;
  let subset: "B" | "C" | null = null;
  const digitsAhead = (from: number) => {
    let n = 0;
    while (from + n < text.length && /[0-9]/.test(text[from + n])) n += 1;
    return n;
  };
  while (i < text.length) {
    const run = digitsAhead(i);
    if (run >= 4 || (run >= 2 && run === text.length - i && subset === "C")) {
      if (subset !== "C") {
        out.push(subset === null ? START_C : CODE_C);
        subset = "C";
      }
      const pairs = Math.floor(run / 2);
      for (let p = 0; p < pairs; p += 1) {
        out.push(Number(text.slice(i, i + 2)));
        i += 2;
      }
      continue;
    }
    if (subset !== "B") {
      out.push(subset === null ? START_B : CODE_B);
      subset = "B";
    }
    out.push(valueB(text[i]));
    i += 1;
  }
  let check = out[0];
  for (let k = 1; k < out.length; k += 1) check += out[k] * k;
  out.push(check % 103);
  out.push(STOP);
  return out;
}

export interface Code128 {
  symbols: number[];
  /** Alternating bar/space widths in modules, starting with a bar. */
  widths: number[];
  /** Total width in modules (no quiet zone). */
  modules: number;
}

export function encodeCode128(text: string): Code128 {
  const symbols = code128Symbols(text);
  const widths: number[] = [];
  for (const s of symbols) {
    for (const ch of PATTERNS[s]) widths.push(Number(ch));
  }
  return { symbols, widths, modules: widths.reduce((a, b) => a + b, 0) };
}

export interface Bar {
  x: number;
  width: number;
}

/** Bars only (x offsets in modules), for drawing. */
export function code128Bars(widths: number[]): Bar[] {
  const bars: Bar[] = [];
  let x = 0;
  widths.forEach((w, index) => {
    if (index % 2 === 0) bars.push({ x, width: w });
    x += w;
  });
  return bars;
}

/** SVG path of the bars: one rect per bar, unit = one module. */
export function code128Path(widths: number[], height: number): string {
  return code128Bars(widths)
    .map((b) => `M${b.x} 0h${b.width}v${height}h-${b.width}z`)
    .join("");
}
