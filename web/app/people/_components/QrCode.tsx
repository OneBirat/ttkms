import { useMemo } from "react";
import { encodeQr, qrPath } from "../_lib/qr";

export interface QrCodeProps {
  value: string;
  /** Rendered size in CSS pixels. */
  size?: number;
  /** Accessible description, e.g. "QR code: open the photo page for Anita". */
  label: string;
  className?: string;
}

/** Scannable QR code as inline SVG (quiet zone of 2 modules included). */
export function QrCode({ value, size = 96, label, className }: QrCodeProps) {
  const { path, modules } = useMemo(() => {
    const result = encodeQr(value);
    return { path: qrPath(result.modules), modules: result.size };
  }, [value]);
  const quiet = 2;
  const total = modules + quiet * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${total} ${total}`}
      shapeRendering="crispEdges"
    >
      <rect width={total} height={total} fill="#fff" />
      <path d={path} fill="#1b2328" transform={`translate(${quiet} ${quiet})`} />
    </svg>
  );
}
