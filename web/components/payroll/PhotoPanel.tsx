"use client";

import { useCallback, useEffect, useState } from "react";
import { QrCode } from "./QrCode";
import { PHOTO_TOKEN_TTL_MS, createPhotoToken } from "./api";
import type { EmployeeProfile, PhotoToken } from "./types";
import styles from "./employees.module.css";

export interface PhotoPanelProps {
  employee: EmployeeProfile;
  onUseDevice: () => void;
  onRemove: () => void;
}

function remaining(token: PhotoToken | null): number {
  if (!token) return 0;
  return Math.max(0, Math.floor((Date.parse(token.expires_at) - Date.now()) / 1000));
}

/** "Update photo from a phone": QR code to the token link, device fallback, remove. */
export function PhotoPanel({ employee, onUseDevice, onRemove }: PhotoPanelProps) {
  const [token, setToken] = useState<PhotoToken | null>(null);
  const [left, setLeft] = useState(0);
  const [localhost, setLocalhost] = useState(false);

  const issue = useCallback(async () => {
    const origin = window.location.origin;
    setLocalhost(/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname));
    const next = await createPhotoToken(employee.id, origin);
    setToken(next);
    setLeft(Math.floor(PHOTO_TOKEN_TTL_MS / 1000));
  }, [employee.id]);

  useEffect(() => {
    void issue();
  }, [issue]);

  useEffect(() => {
    if (!token) return;
    const timer = setInterval(() => setLeft(remaining(token)), 1000);
    return () => clearInterval(timer);
  }, [token]);

  const firstName = employee.full_name.split(" ")[0];
  const expired = token !== null && left <= 0;
  const minutes = Math.floor(left / 60);
  const seconds = String(left % 60).padStart(2, "0");

  return (
    <section aria-labelledby="photo-h" className={`card ${styles.photoPanel}`}>
      {token && !expired ? (
        <QrCode
          value={token.url}
          size={96}
          className={styles.qr}
          label={`QR code: opens the photo page for ${employee.full_name} on a phone`}
        />
      ) : (
        <div className={styles.qrPlaceholder} role="img" aria-label="QR code expired">
          {expired ? "Link expired" : "QR code"}
        </div>
      )}
      <div className={styles.photoText}>
        <h3 id="photo-h" className={styles.photoTitle}>
          Update photo from a phone
        </h3>
        <span className={styles.photoHint}>
          Scan with any phone. It opens the camera page for {firstName} only; the link expires in 10
          minutes
          {token && !expired ? (
            <>
              {" "}
              (<span className="mono">{minutes}:{seconds}</span> left)
            </>
          ) : null}
          . On a phone already, tap the camera button on the photo.
        </span>
        {localhost ? (
          <span className={styles.photoHint} style={{ color: "var(--pill-low-fg)" }}>
            Open TTK by its network address (e.g. http://192.168.x.x:3003) so the phone can reach this
            link.
          </span>
        ) : null}
      </div>
      <div className={styles.photoActions}>
        {expired ? (
          <button type="button" className="btn" onClick={() => void issue()}>
            New QR code
          </button>
        ) : null}
        <button type="button" className="btn" onClick={onUseDevice}>
          Use this device
        </button>
        <button
          type="button"
          className={styles.removeButton}
          onClick={onRemove}
          disabled={!employee.photo_url}
          aria-disabled={!employee.photo_url}
        >
          Remove photo
        </button>
      </div>
    </section>
  );
}
