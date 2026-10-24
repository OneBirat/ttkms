"use client";

import { useMemo } from "react";
import { code128Bars, encodeCode128 } from "../_lib/code128";

export interface BarcodeProps {
  /** The encoded value, e.g. "TTK-E001". */
  value: string;
  /** Bar height in CSS px. */
  height?: number;
  /** Width of one module in CSS px (2 = scannable from a phone screen). */
  unit?: number;
  label: string;
  className?: string;
}

const QUIET = 10;

/** Code 128 as inline SVG, quiet zones included. */
export function Barcode({ value, height = 56, unit = 2, label, className }: BarcodeProps) {
  const code = useMemo(() => encodeCode128(value), [value]);
  const bars = useMemo(() => code128Bars(code.widths), [code]);
  const total = code.modules + QUIET * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      className={className}
      width={total * unit}
      height={height}
      viewBox={`0 0 ${total} ${height}`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
    >
      <rect width={total} height={height} fill="#fff" />
      {bars.map((b) => (
        <rect key={b.x} x={b.x + QUIET} y={0} width={b.width} height={height} fill="#1b2328" />
      ))}
    </svg>
  );
}

/**
 * Renders the barcode plus the code and the full name under it to a PNG and
 * downloads it (the sticker admin prints from Admin › Barcodes uses the same
 * value). Scale 4 = 2.5 modules per printed dot at 300 dpi.
 */
export function downloadBarcodePng(value: string, name: string, filename: string, scale = 4): boolean {
  const code = encodeCode128(value);
  const bars = code128Bars(code.widths);
  const unit = scale;
  const quiet = QUIET * unit;
  const barHeight = 70 * scale * 0.5;
  const width = code.modules * unit + quiet * 2;
  const textBlock = 22 * scale * 0.5 * 2 + 10 * scale * 0.5;
  const height = barHeight + textBlock + 12 * scale * 0.5;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#1b2328";
  const top = 6 * scale * 0.5;
  for (const b of bars) {
    ctx.fillRect(quiet + b.x * unit, top, b.width * unit, barHeight);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = `600 ${11 * scale}px "IBM Plex Mono", ui-monospace, monospace`;
  ctx.fillText(value, width / 2, top + barHeight + 4 * scale * 0.5);
  ctx.font = `500 ${9 * scale}px "IBM Plex Sans", system-ui, sans-serif`;
  ctx.fillText(name, width / 2, top + barHeight + 4 * scale * 0.5 + 14 * scale);
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  return true;
}
