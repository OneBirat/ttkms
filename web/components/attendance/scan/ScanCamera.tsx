"use client";

import { useState, type FormEvent } from "react";
import { TorchIcon } from "../icons";
import { useDialog } from "../useDialog";
import type { MarkState } from "../useMarkState";
import { VoiceControls } from "../VoiceControls";
import { isSheetStep } from "./scanFlow";
import { SCANNER_HINT, useBarcodeScanner } from "./useBarcodeScanner";
import styles from "./scan.module.css";

/**
 * Full-screen camera scanner (design/scanner/AttendanceScanCamera.dc.html).
 * Mounted for the whole scanning session on a phone so the camera stream
 * survives the sheets; decoding pauses while a sheet is open.
 */
export function ScanCamera({ state }: { state: MarkState }) {
  const [typed, setTyped] = useState("");
  const scan = state.scan;
  const step = scan?.step;
  const sheetOpen = isSheetStep(step);
  const busy = step === "camera" && scan?.busy === true;
  const last = step === "camera" ? scan?.last : undefined;
  const dialog = useDialog(() => state.flow.stop(), { autoFocus: false });
  const scanner = useBarcodeScanner({
    active: scan !== null,
    decoding: step === "camera" && !busy,
    onCode: (code) => state.flow.scan(code),
  });
  const branch = state.data?.branches.find((b) => b.id === state.branchId)?.name ?? "";

  const find = (event: FormEvent) => {
    event.preventDefault();
    if (typed.trim()) {
      state.flow.scan(typed);
      setTyped("");
    }
  };

  return (
    <section
      ref={dialog.ref}
      role="dialog"
      aria-modal={!sheetOpen}
      aria-label="Barcode scanner"
      aria-hidden={sheetOpen || undefined}
      tabIndex={-1}
      className={styles.camera}
      onKeyDown={dialog.onKeyDown}
    >
      <div className={styles.cameraTop}>
        <button type="button" aria-label="Close scanner" className={styles.cameraBtn} onClick={() => state.flow.stop()}>
          ×
        </button>
        <div className={styles.cameraTitle}>
          <span>Scan staff card</span>
          <span className={styles.cameraSub}>
            {state.today?.bs_text ?? ""}
            {branch ? ` · ${branch}` : ""}
          </span>
        </div>
        <VoiceControls variant="dark" />
        <button
          type="button"
          aria-label="Torch"
          aria-pressed={scanner.torchOn}
          className={styles.cameraBtn}
          onClick={scanner.toggleTorch}
          disabled={!scanner.torchSupported}
        >
          <TorchIcon />
        </button>
      </div>

      <div className={styles.lastRow}>
        {last ? (
          <span role="status" className={styles.lastPill}>
            {last}
          </span>
        ) : null}
        <span className={styles.scanCount}>Scanned: {state.scanCount}</span>
      </div>

      <div className={styles.viewport}>
        <video ref={scanner.videoRef} className={styles.video} playsInline muted autoPlay />
        <div className={styles.frame} aria-hidden="true">
          <span className={`${styles.corner} ${styles.cornerTl}`} />
          <span className={`${styles.corner} ${styles.cornerTr}`} />
          <span className={`${styles.corner} ${styles.cornerBl}`} />
          <span className={`${styles.corner} ${styles.cornerBr}`} />
          <span className={styles.scanLine} />
          {scanner.status !== "scanning" ? (
            <div className={styles.fakeBars}>
              {[2, 1, 3, 1, 2, 1, 4, 1, 2].map((w, i) => (
                <span key={i} style={{ flex: w }} />
              ))}
            </div>
          ) : null}
        </div>
        <div className={styles.hints}>
          <span className={styles.hint} role="status">
            {busy ? "Looking up the card…" : SCANNER_HINT[scanner.status] || SCANNER_HINT.scanning}
          </span>
          <span className={styles.hintNp} lang="ne">
            कार्डको बारकोड फ्रेमभित्र राख्नुहोस्
          </span>
        </div>
        <div className={styles.cancelWrap}>
          <button
            type="button"
            aria-label="Cancel scanning"
            title="Cancel scanning"
            className={styles.cancelRound}
            onClick={() => state.flow.stop()}
          >
            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <span aria-hidden="true" className={styles.cancelLabel}>
            Cancel
            <span className={styles.cancelNp}>रद्द गर्नुहोस्</span>
          </span>
        </div>
      </div>

      <form className={styles.cameraBottom} onSubmit={find}>
        <div className={styles.typeRow}>
          <div className={styles.typeField}>
            <input
              aria-label="Type employee ID"
              placeholder="Or type ID, e.g. E-004"
              value={typed}
              autoComplete="off"
              inputMode="text"
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
          <button type="submit" className={styles.findBtn} disabled={busy || !typed.trim()}>
            Find
          </button>
        </div>
      </form>
    </section>
  );
}
