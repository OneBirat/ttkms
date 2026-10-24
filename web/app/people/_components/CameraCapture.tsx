"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PayrollIcon } from "./icons";
import { captureFrame } from "../_lib/image";
import styles from "./photo.module.css";

export interface CameraCaptureProps {
  onCaptured: (dataUrl: string) => void;
  onCancel: () => void;
}

type Facing = "user" | "environment";

/**
 * Live camera preview with a face-oval guide, shutter and camera switch.
 * Uses getUserMedia; the parent falls back to a file input when that is not
 * available (see PhotoFlow).
 */
export function CameraCapture({ onCaptured, onCancel }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<Facing>("user");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canSwitch, setCanSwitch] = useState(true);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);
    stop();
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: facing, width: { ideal: 960 }, height: { ideal: 1280 } },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.play().catch(() => undefined);
        }
        setReady(true);
        navigator.mediaDevices
          .enumerateDevices()
          .then((devices) => {
            if (!cancelled) setCanSwitch(devices.filter((d) => d.kind === "videoinput").length > 1);
          })
          .catch(() => undefined);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const name = err instanceof Error ? err.name : "";
        setError(
          name === "NotAllowedError"
            ? "Camera access was refused. Allow the camera in the browser settings or choose a photo from the gallery."
            : "The camera could not be started. Choose a photo from the gallery instead.",
        );
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [facing, stop]);

  const shoot = () => {
    const video = videoRef.current;
    if (!video || !ready) return;
    try {
      const dataUrl = captureFrame(video, facing === "user");
      stop();
      onCaptured(dataUrl);
    } catch {
      setError("Could not take the photo. Try again.");
    }
  };

  return (
    <div className={styles.camera}>
      <div className={styles.viewport}>
        <video
          ref={videoRef}
          className={facing === "user" ? `${styles.video} ${styles.mirrored}` : styles.video}
          playsInline
          muted
          autoPlay
          aria-label="Live camera preview"
        />
        <div className={styles.oval} aria-hidden="true" />
        <span className={styles.viewportText}>
          {error ? "" : ready ? "Fit the face inside the oval" : "Starting the camera…"}
        </span>
        {error ? (
          <p className={styles.error} role="alert" style={{ position: "absolute", left: 16, right: 16, bottom: 16, width: "auto" }}>
            {error}
          </p>
        ) : null}
      </div>
      <div className={styles.cameraBar}>
        <button type="button" className={styles.cameraCancel} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.shutter}
          aria-label="Take photo"
          onClick={shoot}
          disabled={!ready}
        />
        <button
          type="button"
          className={styles.switch}
          aria-label={facing === "user" ? "Switch to the back camera" : "Switch to the front camera"}
          onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
          disabled={!canSwitch}
        >
          <PayrollIcon name="switch-camera" size={22} />
        </button>
      </div>
    </div>
  );
}
