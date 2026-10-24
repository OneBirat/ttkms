"use client";

import { useId, useState } from "react";
import { RATE_MAX, RATE_MIN, SPEECH, speak, unlockAudio, voiceStatusText } from "./speak";
import { useDialog } from "./useDialog";
import { useVoiceInfo, useVoiceSettings } from "./useVoice";
import styles from "./voice.module.css";

export interface VoiceControlsProps {
  /** "dark" on the camera header, "light" beside the desktop scan box. */
  variant: "dark" | "light";
}

/** Speaker toggle + ⚙ that opens the small "Voice settings" sheet. */
export function VoiceControls({ variant }: VoiceControlsProps) {
  const [settings, update] = useVoiceSettings();
  const [open, setOpen] = useState(false);
  const cls = variant === "dark" ? styles.btnDark : styles.btnLight;
  return (
    <>
      <button
        type="button"
        className={cls}
        aria-pressed={settings.enabled}
        aria-label={settings.enabled ? "Spoken confirmation on" : "Spoken confirmation off"}
        title={settings.enabled ? "Voice on" : "Voice off"}
        onClick={() => {
          unlockAudio();
          update({ enabled: !settings.enabled });
        }}
      >
        <span aria-hidden="true">{settings.enabled ? "🔊" : "🔇"}</span>
      </button>
      <button
        type="button"
        className={cls}
        aria-label="Voice settings"
        aria-haspopup="dialog"
        title="Voice settings"
        onClick={() => {
          unlockAudio();
          setOpen(true);
        }}
      >
        <span aria-hidden="true">⚙</span>
      </button>
      {open ? <VoiceSettingsSheet onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function VoiceSettingsSheet({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const dialog = useDialog(onClose);
  const [settings, update] = useVoiceSettings();
  const info = useVoiceInfo(true);
  const [help, setHelp] = useState(false);
  const status = !info.supported
    ? "This browser has no speech output"
    : info.picked
      ? voiceStatusText(info.picked)
      : "Finding voices…";
  const needsHelp = info.supported && info.picked !== null && info.picked.kind !== "nepali";
  return (
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog.ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={styles.sheet}
        onKeyDown={dialog.onKeyDown}
      >
        <div className={styles.head}>
          <h2 id={titleId} className={styles.title}>
            Voice settings
          </h2>
          <button type="button" aria-label="Close" className={styles.close} onClick={onClose}>
            ×
          </button>
        </div>
        <label className={styles.row}>
          <span>Speak each scan</span>
          <input
            type="checkbox"
            role="switch"
            checked={settings.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
        </label>
        <label className={styles.rowCol}>
          <span className={styles.rowLabel}>
            Speed <span className="mono">{settings.rate.toFixed(2)}×</span>
          </span>
          <input
            type="range"
            min={RATE_MIN}
            max={RATE_MAX}
            step={0.05}
            value={settings.rate}
            onChange={(e) => update({ rate: Number(e.target.value) })}
          />
        </label>
        <p className={styles.status} role="status">
          {status}
        </p>
        {needsHelp ? (
          <div className={styles.help}>
            <button type="button" className={styles.helpLink} onClick={() => setHelp((v) => !v)}>
              How to install a Nepali voice
            </button>
            {help ? (
              <ul className={styles.helpSteps}>
                <li>
                  <strong>Android:</strong> Settings → Text-to-speech output → Speech Services by Google
                  → ⚙ → Install voice data → नेपाली → download, then set the language to Nepali.
                </li>
                <li>
                  <strong>iPhone:</strong> no Nepali voice is available; Hindi is used.
                </li>
              </ul>
            ) : null}
          </div>
        ) : null}
        <button
          type="button"
          className={styles.test}
          disabled={!info.supported}
          onClick={() => {
            unlockAudio();
            void speak(SPEECH.test(), { force: true });
          }}
        >
          Test voice
        </button>
      </div>
    </div>
  );
}
