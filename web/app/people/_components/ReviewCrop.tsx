"use client";

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { DEFAULT_CROP, cropGeometry, cropToCircle, loadImage, type CropState } from "../_lib/image";
import styles from "./photo.module.css";

export interface ReviewCropProps {
  src: string;
  onUse: (dataUrl: string) => Promise<void> | void;
  onRetake: () => void;
  retakeLabel?: string;
  busy?: boolean;
}

const PREVIEW = 240;

/** Circle crop with a zoom slider and drag-to-position, then "Use this photo". */
export function ReviewCrop({ src, onUse, onRetake, retakeLabel = "Retake", busy = false }: ReviewCropProps) {
  const zoomId = useId();
  const [crop, setCrop] = useState<CropState>({ ...DEFAULT_CROP, zoom: 1.2 });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadImage(src)
      .then((image) => {
        if (!cancelled) setNatural({ w: image.naturalWidth, h: image.naturalHeight });
      })
      .catch(() => setError("Could not read this image."));
    return () => {
      cancelled = true;
    };
  }, [src]);

  const geometry = natural ? cropGeometry(natural.w, natural.h, crop, PREVIEW) : null;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: event.clientX, y: event.clientY, ox: crop.offsetX, oy: crop.offsetY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    setCrop((c) => ({ ...c, offsetX: drag.current!.ox + dx, offsetY: drag.current!.oy + dy }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const use = async () => {
    setSaving(true);
    setError(null);
    try {
      // Offsets are in preview pixels; scale them to the export size.
      const scaled: CropState = {
        zoom: crop.zoom,
        offsetX: (crop.offsetX * 512) / PREVIEW,
        offsetY: (crop.offsetY * 512) / PREVIEW,
      };
      const dataUrl = await cropToCircle(src, scaled, 512);
      await onUse(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the photo.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.review}>
      <div
        className={styles.circle}
        role="img"
        aria-label="Captured photo, cropped to a circle. Drag to move it."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {geometry ? (
          // eslint-disable-next-line @next/next/no-img-element -- local data: URL preview
          <img
            src={src}
            alt=""
            draggable={false}
            style={{ left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height }}
          />
        ) : null}
      </div>
      <div className={styles.zoomRow}>
        <label htmlFor={zoomId} className={styles.zoomLabel}>
          Zoom and position
        </label>
        <input
          id={zoomId}
          type="range"
          min={1}
          max={3}
          step={0.1}
          value={crop.zoom}
          className={styles.zoom}
          onChange={(event) => setCrop((c) => ({ ...c, zoom: Number(event.target.value) }))}
        />
        <span className={styles.note} style={{ fontSize: 12, color: "var(--color-muted)" }}>
          Drag the photo to move it inside the circle
        </span>
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.big} ${styles.bigPrimary}`}
          onClick={() => void use()}
          disabled={saving || busy || !natural}
        >
          {saving || busy ? "Saving…" : "Use this photo"}
        </button>
        <button type="button" className={styles.big} onClick={onRetake} disabled={saving || busy}>
          {retakeLabel}
        </button>
      </div>
    </div>
  );
}
