"use client";

import { useState, type FormEvent } from "react";
import { TorchIcon } from "../icons";
import { VoiceControls } from "../VoiceControls";
import { useDialog } from "../useDialog";
import type { MarkState } from "../useMarkState";
import { SCANNER_HINT, useBarcodeScanner } from "./useBarcodeScanner";
import styles from "./scan.module.css";

/**
 * Full-screen camera scanner (design/attendance/AttendanceScanCamera.dc.html):
 * viewfinder with frame and scan line, EN + Nepali hint, torch, "Or type ID" + Find.
 */
export function ScanCamera({ state }: { state: MarkState }) {
  const [typed, setTyped] = useState("");
  const dialog = useDialog(state.closeScan, { autoFocus: false });
  const scanner = useBarcodeScanner(true, (code) => state.submitCode(code));
  const branch = state.data?.branches.find((b) => b.id === state.branchId)?.name ?? "";
  const busy = state.scan?.busy ?? false;

  const find = (event: FormEvent) => {
    event.preventDefault();
    if (typed.trim()) state.submitCode(typed);
  };

  return (
    <section
      ref={dialog.ref}
      role="dialog"
      aria-modal="true"
      aria-label="Barcode scanner"
      tabIndex={-1}
      className={styles.camera}
      onKeyDown={dialog.onKeyDown}
    >
      <div className={styles.cameraTop}>
        <button type="button" aria-label="Close scanner" className={styles.cameraBtn} onClick={state.closeScan}>
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
        <span className={styles.hint} role="status">
          {busy ? "Looking up the card…" : SCANNER_HINT[scanner.status] || SCANNER_HINT.scanning}
        </span>
        <span className={styles.hintNp} lang="ne">
          कार्डको बारकोड फ्रेमभित्र राख्नुहोस्
        </span>
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
              data-autofocus=""
            />
          </div>
          <button type="submit" className={styles.findBtn} disabled={busy || !typed.trim()}>
            Find
          </button>
        </div>
        {state.scan?.error ? (
          <span className={styles.cameraError} role="alert">
            {state.scan.error}
          </span>
        ) : null}
      </form>
    </section>
  );
}
