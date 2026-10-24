"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Camera barcode reading with the browser's BarcodeDetector API (Chrome on
 * Android, Safari 17+). Browsers without it get the camera preview and the
 * "type ID" box only; NEEDS FROM MAIN: add @zxing/browser as the fallback
 * decoder for those (Firefox, older Safari). Staff cards carry "TTK-E001" as
 * Code 128 or as a QR code; both are read.
 *
 * The MediaStream stays alive between people: `active` owns the stream,
 * `decoding` only pauses the detect loop while a sheet is open. Tracks are
 * released when the scanner closes, the component unmounts or the page is
 * hidden, and re-acquired when it is visible again.
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

/** Symbologies printed on staff cards. */
export const CARD_FORMATS = ["qr_code", "code_128"];

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

export interface BarcodeScannerOptions {
  /** Keep the camera stream open. */
  active: boolean;
  /** Run the detect loop (false while a sheet is open). */
  decoding: boolean;
  onCode: (code: string) => void;
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === "undefined" ? true : document.visibilityState !== "hidden",
  );
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

export function useBarcodeScanner({ active, decoding, onCode }: BarcodeScannerOptions): BarcodeScanner {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const decodingRef = useRef(decoding);
  decodingRef.current = decoding;
  const [status, setStatus] = useState<ScannerStatus>("idle");
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const visible = usePageVisible();
  const streaming = active && visible;

  useEffect(() => {
    if (!streaming) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;

    const stop = () => {
      if (timer) window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      trackRef.current = null;
      detectorRef.current = null;
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
      try {
        const supported = Detector.getSupportedFormats ? await Detector.getSupportedFormats() : [];
        const wanted = CARD_FORMATS.filter((f) => supported.includes(f));
        detectorRef.current = new Detector(wanted.length ? { formats: wanted } : undefined);
      } catch {
        setStatus("no-detector");
        return;
      }
      if (cancelled) return;
      setStatus("scanning");

      let busy = false;
      timer = window.setInterval(async () => {
        const v = videoRef.current;
        const detector = detectorRef.current;
        if (busy || cancelled || !decodingRef.current || !detector || !v || v.readyState < 2) return;
        busy = true;
        try {
          const codes = await detector.detect(v);
          const hit = codes.find((c) => c.rawValue && c.rawValue.trim());
          if (hit && !cancelled && decodingRef.current) onCodeRef.current(hit.rawValue.trim());
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
  }, [streaming]);

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
