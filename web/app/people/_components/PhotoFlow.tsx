"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Icon } from "@/components/icons";
import { PayrollIcon } from "./icons";
import { Avatar } from "./Avatar";
import { CameraCapture } from "./CameraCapture";
import { ReviewCrop } from "./ReviewCrop";
import { cameraAvailable, fileToDataUrl, shrinkImage } from "../_lib/image";
import styles from "./photo.module.css";

export type PhotoStep = "start" | "camera" | "review" | "done";

export interface PhotoFlowProps {
  employeeName: string;
  currentPhoto: string | null;
  /** Persist the 512px JPEG; the flow shows "done" once it resolves. */
  onSave: (dataUrl: string) => Promise<void>;
  /** "Done" button on the final step; omit to hide it. */
  onDone?: () => void;
  /** Smaller paddings inside a dialog. */
  compact?: boolean;
  /** Copy for the final step. */
  doneText?: string;
}

/**
 * start → camera → review → done. Uses getUserMedia when the page is secure
 * (HTTPS or localhost) and falls back to <input type="file" capture="user">
 * otherwise. Shared by the phone page, the "Use this device" dialog and the
 * Add-employee popup.
 */
export function PhotoFlow({ employeeName, currentPhoto, onSave, onDone, compact = false, doneText }: PhotoFlowProps) {
  const [step, setStep] = useState<PhotoStep>("start");
  const [shot, setShot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secure, setSecure] = useState(true);
  const [hasCamera, setHasCamera] = useState(false);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSecure(typeof window === "undefined" ? true : window.isSecureContext);
    setHasCamera(cameraAvailable());
  }, []);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    try {
      const raw = await fileToDataUrl(file);
      setShot(await shrinkImage(raw));
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read this file.");
    }
  };

  const takePhoto = () => {
    if (hasCamera) setStep("camera");
    else cameraInput.current?.click();
  };

  const save = async (dataUrl: string) => {
    await onSave(dataUrl);
    setStep("done");
  };

  const wrap = compact ? `${styles.flow} ${styles.compact}` : styles.flow;

  if (step === "camera") {
    return (
      <div className={wrap}>
        <CameraCapture
          onCaptured={(dataUrl) => {
            setShot(dataUrl);
            setStep("review");
          }}
          onCancel={() => setStep("start")}
        />
      </div>
    );
  }

  if (step === "review" && shot) {
    return (
      <div className={wrap}>
        <ReviewCrop src={shot} onUse={save} onRetake={takePhoto} retakeLabel={hasCamera ? "Retake" : "Choose another"} />
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className={wrap}>
        <div className={styles.done} role="status">
          <span className={styles.doneIcon}>
            <Icon name="check" size={34} />
          </span>
          <h2 className={styles.doneTitle}>Photo saved</h2>
          <p className={styles.guide}>
            {doneText ??
              `${employeeName.split(" ")[0]}'s profile now shows the new photo. The computer that showed the QR code updates by itself.`}
          </p>
          {onDone ? (
            <button type="button" className={styles.big} style={{ marginTop: 12 }} onClick={onDone}>
              Done
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={wrap}>
      <div className={styles.start}>
        <Avatar name={employeeName} photoUrl={currentPhoto} size={160} tone="profile" />
        <p className={styles.guide}>
          Face the camera in good light, no cap or sunglasses. The photo shows on the profile, attendance
          sheet and payslip.
        </p>
        {!secure ? (
          <p className={styles.hint}>
            The camera needs HTTPS or localhost. On this address the phone&apos;s own camera app opens
            instead; that works too.
          </p>
        ) : null}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.actions}>
          <button type="button" className={`${styles.big} ${styles.bigPrimary}`} onClick={takePhoto}>
            <PayrollIcon name="camera" size={20} />
            Take photo
          </button>
          <button type="button" className={styles.big} onClick={() => galleryInput.current?.click()}>
            Choose from gallery
          </button>
        </div>
        <input
          ref={cameraInput}
          className={styles.fileInput}
          type="file"
          accept="image/*"
          capture="user"
          aria-label="Take a photo with the camera app"
          tabIndex={-1}
          onChange={(event) => void onFile(event)}
        />
        <input
          ref={galleryInput}
          className={styles.fileInput}
          type="file"
          accept="image/*"
          aria-label="Choose a photo from the gallery"
          tabIndex={-1}
          onChange={(event) => void onFile(event)}
        />
      </div>
    </div>
  );
}
