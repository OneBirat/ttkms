"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Camera barcode reading with the browser's BarcodeDetector API (Chrome on
 * Android, Safari 17+). Browsers without it get the camera preview and the
 * "type ID" box only; NEEDS FROM MAIN: add @zxing/browser as the fallback
 * decoder for those (Firefox, older Safari). Staff cards carry Code 128
 * "TTK-E001".
 */

interface DetectedBarcode {
  rawValue: string;
  format: string;
}

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorCtor;
  }
}

export type ScannerStatus =
  | "idle"
  | "starting"
  | "scanning"
  /** Camera works, but this browser cannot decode barcodes (no BarcodeDetector). */
  | "no-detector"
  | "no-camera"
  | "denied";

export const SCANNER_HINT: Record<ScannerStatus, string> = {
  idle: "",
  starting: "Starting the camera…",
  scanning: "Hold the staff card's barcode inside the frame",
  "no-detector": "This browser can't read barcodes yet · type the ID below",
  "no-camera": "No camera here · type the ID below",
  denied: "Camera blocked · allow it in the browser, or type the ID below",
};

export interface BarcodeScanner {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: ScannerStatus;
  torchSupported: boolean;
  torchOn: boolean;
  toggleTorch: () => void;
}

export function useBarcodeScanner(active: boolean, onCode: (code: string) => void): BarcodeScanner {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const [status, setStatus] = useState<ScannerStatus>("idle");
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;

    const stop = () => {
      if (timer) window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      trackRef.current = null;
    };

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("no-camera");
      return;
    }
    setStatus("starting");

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch (err) {
        if (!cancelled) {
          setStatus(err instanceof DOMException && err.name === "NotAllowedError" ? "denied" : "no-camera");
        }
        return;
      }
      if (cancelled) {
        stop();
        return;
      }
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      if (cancelled) {
        stop();
        return;
      }
      const track = stream.getVideoTracks()[0] ?? null;
      trackRef.current = track;
      let torch = false;
      try {
        const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
        torch = Boolean(capabilities?.torch);
      } catch {
        torch = false;
      }
      setTorchSupported(torch);

      const Detector = window.BarcodeDetector;
      if (!Detector) {
        setStatus("no-detector");
        return;
      }
      let detector: BarcodeDetectorLike;
      try {
        const formats = Detector.getSupportedFormats ? await Detector.getSupportedFormats() : [];
        detector = new Detector(formats.includes("code_128") ? { formats: ["code_128"] } : undefined);
      } catch {
        setStatus("no-detector");
        return;
      }
      if (cancelled) return;
      setStatus("scanning");

      let busy = false;
      timer = window.setInterval(async () => {
        const v = videoRef.current;
        if (busy || cancelled || !v || v.readyState < 2) return;
        busy = true;
        try {
          const codes = await detector.detect(v);
          const hit = codes.find((c) => c.rawValue && c.rawValue.trim());
          if (hit && !cancelled) {
            window.clearInterval(timer);
            onCodeRef.current(hit.rawValue.trim());
          }
        } catch {
          // A frame that could not be decoded; keep trying.
        } finally {
          busy = false;
        }
      }, 250);
    })();

    return () => {
      cancelled = true;
      stop();
      setTorchOn(false);
      setTorchSupported(false);
      setStatus("idle");
    };
  }, [active]);

  const toggleTorch = () => {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    track
      .applyConstraints({ advanced: [{ torch: next } as unknown as MediaTrackConstraintSet] })
      .then(() => setTorchOn(next))
      .catch(() => undefined);
  };

  return { videoRef, status, torchSupported, torchOn, toggleTorch };
}
