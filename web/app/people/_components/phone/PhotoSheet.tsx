"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { BottomSheet } from "./BottomSheet";
import { Avatar } from "../Avatar";
import { CameraCapture } from "../CameraCapture";
import { ReviewCrop } from "../ReviewCrop";
import { setEmployeePhoto } from "../../api";
import { cameraAvailable, fileToDataUrl, shrinkImage } from "../../_lib/image";
import type { Employee } from "../../types";
import styles from "./phone.module.css";
import photo from "../photo.module.css";

export interface PhotoSheetProps {
  open: boolean;
  employee: Employee;
  onClose: () => void;
  /** Confirmation text after a change. */
  onChanged: (text: string) => void;
}

type Step = null | "camera" | "review";

/**
 * "Update profile picture" sheet: Take photo / Choose from gallery / Remove
 * photo (only when one exists) / Cancel, then camera → crop → saved.
 */
export function PhotoSheet({ open, employee, onClose, onChanged }: PhotoSheetProps) {
  const [step, setStep] = useState<Step>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [source, setSource] = useState<"camera" | "gallery">("camera");
  const galleryInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const onFile = async (event: ChangeEvent<HTMLInputElement>, from: "camera" | "gallery") => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setSource(from);
    setShot(await shrinkImage(await fileToDataUrl(file)));
    setStep("review");
  };

  const takePhoto = () => {
    setSource("camera");
    if (cameraAvailable()) setStep("camera");
    else cameraInput.current?.click();
  };

  const save = async (dataUrl: string) => {
    await setEmployeePhoto(employee.id, dataUrl);
    setStep(null);
    setShot(null);
    onChanged(source === "camera" ? "Photo updated from camera" : "Photo updated from gallery");
    onClose();
  };

  const remove = async () => {
    await setEmployeePhoto(employee.id, null);
    onChanged("Photo removed — initials shown instead");
    onClose();
  };

  if (step === "camera") {
    return (
      <div className={styles.overlay}>
        <div className={photo.flow} style={{ maxWidth: "none" }}>
          <CameraCapture
            onCaptured={(dataUrl) => {
              setShot(dataUrl);
              setStep("review");
            }}
            onCancel={() => setStep(null)}
          />
        </div>
      </div>
    );
  }
  if (step === "review" && shot) {
    return (
      <div className={`${styles.overlay} ${styles.overlayLight}`}>
        <div className={photo.flow}>
          <ReviewCrop src={shot} onUse={save} onRetake={() => (source === "camera" ? takePhoto() : galleryInput.current?.click())} retakeLabel={source === "camera" ? "Retake" : "Choose another"} />
          <button type="button" className={photo.big} style={{ margin: "0 20px 20px", width: "auto" }} onClick={() => setStep(null)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <BottomSheet open={open} label="Profile picture" onClose={onClose}>
        <div className={styles.sheetHeader}>
          <Avatar name={employee.full_name} photoUrl={employee.photo_url} size={56} tone="profile" />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <h2 style={{ fontSize: 17, fontWeight: 700 }}>Profile picture</h2>
            <span className={styles.rowSub}>{employee.full_name} · shown on attendance and payslips</span>
          </div>
        </div>
        <button type="button" className={styles.sheetAction} onClick={takePhoto}>
          📷 Take photo
        </button>
        <button type="button" className={styles.sheetAction} onClick={() => galleryInput.current?.click()}>
          🖼 Choose from gallery
        </button>
        {employee.photo_url ? (
          <button type="button" className={styles.sheetAction} data-tone="danger" onClick={() => void remove()}>
            🗑 Remove photo
          </button>
        ) : null}
        <button type="button" className={styles.sheetCancel} onClick={onClose}>
          Cancel
        </button>
      </BottomSheet>
      <input ref={galleryInput} type="file" accept="image/*" className={styles.fileInput} tabIndex={-1} aria-label="Choose a photo from the gallery" onChange={(e) => void onFile(e, "gallery")} />
      <input ref={cameraInput} type="file" accept="image/*" capture="user" className={styles.fileInput} tabIndex={-1} aria-label="Take a photo with the camera app" onChange={(e) => void onFile(e, "camera")} />
    </>
  );
}
