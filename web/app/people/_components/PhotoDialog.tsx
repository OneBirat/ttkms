"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PhotoFlow } from "./PhotoFlow";
import { QrCode } from "./QrCode";
import { PayrollIcon } from "./icons";
import { createPhotoToken, setEmployeePhoto } from "../api";
import type { Employee, PhotoToken } from "../types";
import { payrollErrorMessage } from "../_lib/usePayroll";
import photo from "./photo.module.css";
import styles from "./employees.module.css";
import shared from "./payroll.module.css";

export interface PhotoDialogProps {
  open: boolean;
  employee: Employee;
  onClose: () => void;
  onChanged: (text: string) => void;
}

function secondsLeft(token: PhotoToken | null): number {
  if (!token) return 0;
  return Math.max(0, Math.round((Date.parse(token.expires_at) - Date.now()) / 1000));
}

function isLocalhost(): boolean {
  if (typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
}

/**
 * "Update photo from a phone": a QR code that opens /people/photo/<token> on
 * the phone (10-minute link), or take the photo on this device. The account
 * page refreshes by itself when the phone saves (store broadcast).
 */
export function PhotoDialog({ open, employee, onClose, onChanged }: PhotoDialogProps) {
  const [mode, setMode] = useState<"qr" | "device">("qr");
  const [token, setToken] = useState<PhotoToken | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(0);

  const renew = useCallback(async () => {
    setError(null);
    try {
      const created = await createPhotoToken(employee.id, window.location.origin);
      setToken(created);
      setLeft(secondsLeft(created));
    } catch (err) {
      setError(payrollErrorMessage(err));
    }
  }, [employee.id]);

  useEffect(() => {
    if (!open) return;
    setMode("qr");
    void renew();
  }, [open, renew]);

  useEffect(() => {
    if (!open || !token) return;
    const timer = setInterval(() => setLeft(secondsLeft(token)), 1000);
    return () => clearInterval(timer);
  }, [open, token]);

  const expired = Boolean(token) && left <= 0;
  const minutes = Math.floor(left / 60);
  const seconds = String(left % 60).padStart(2, "0");

  const remove = async () => {
    await setEmployeePhoto(employee.id, null);
    onChanged("Photo removed.");
    onClose();
  };

  return (
    <Modal open={open} title={mode === "qr" ? "Update photo" : "Take photo"} onClose={onClose} size="md">
      {mode === "device" ? (
        <div className={`${photo.flow} ${photo.compact}`}>
          <PhotoFlow
            employeeName={employee.full_name}
            currentPhoto={employee.photo_url}
            compact
            onSave={async (dataUrl) => {
              await setEmployeePhoto(employee.id, dataUrl);
              onChanged("Photo updated.");
            }}
            onDone={onClose}
            doneText="The new photo is saved on the employee account."
          />
          <button type="button" className="btn btn--ghost" onClick={() => setMode("qr")}>
            Back to QR code
          </button>
        </div>
      ) : (
        <div className={shared.stack}>
          <div className={styles.photoPanel}>
            {token && !expired ? (
              <QrCode
                value={token.url}
                size={120}
                label={`QR code: open the photo page for ${employee.full_name} on a phone`}
                className={styles.qr}
              />
            ) : (
              <div className={styles.qrPlaceholder}>{error ? "No code" : expired ? "Expired" : "Creating…"}</div>
            )}
            <div className={styles.photoText}>
              <span className={styles.photoTitle}>Update photo from a phone</span>
              <span className={styles.photoHint}>
                Scan with the phone camera, take the photo, done. The photo appears here by itself.
              </span>
              <span className={shared.note}>
                {expired
                  ? "This code has expired."
                  : token
                    ? `Link valid for ${minutes}:${seconds} · ${employee.full_name} only`
                    : error ?? "Creating a link…"}
              </span>
              {isLocalhost() ? (
                <span className={shared.note}>
                  Phones cannot open <span className="mono">localhost</span>: open this app through the
                  computer&apos;s network address (and HTTPS for the camera) before scanning.
                </span>
              ) : null}
              <div className={styles.photoActions}>
                <button type="button" className="btn btn--sm" onClick={() => void renew()}>
                  New QR code
                </button>
                <button type="button" className="btn btn--sm" onClick={() => setMode("device")}>
                  <PayrollIcon name="camera" size={16} />
                  Use this device
                </button>
                {token ? (
                  <a className="btn btn--sm btn--ghost" href={token.url} target="_blank" rel="noreferrer">
                    Open link
                    <PayrollIcon name="external" size={14} />
                  </a>
                ) : null}
              </div>
            </div>
          </div>
          {employee.photo_url ? (
            <div className={shared.between}>
              <span className={shared.note}>Current photo is shown on the profile card.</span>
              <button type="button" className={styles.removeButton} onClick={() => void remove()}>
                Remove photo
              </button>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
