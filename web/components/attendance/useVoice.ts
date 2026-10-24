"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  currentVoice,
  getSpeechStatus,
  getVoiceSettings,
  hasSpeech,
  setVoiceSettings,
  subscribeSpeechStatus,
  subscribeVoiceSettings,
  type PickedVoice,
  type SpeechStatus,
  type VoiceSettings,
} from "./speak";

const IDLE_STATUS: SpeechStatus = { outcome: "idle", text: "", voice: "", detail: "", at: 0 };

/** What happened to the last utterance (diagnostic line in the settings sheet). */
export function useSpeechStatus(): SpeechStatus {
  return useSyncExternalStore(subscribeSpeechStatus, getSpeechStatus, () => IDLE_STATUS);
}

const SERVER_SETTINGS: VoiceSettings = { enabled: true, rate: 0.95 };

/** The shared voice settings (localStorage "ttk.scanVoice"), live across components. */
export function useVoiceSettings(): [VoiceSettings, (patch: Partial<VoiceSettings>) => void] {
  const settings = useSyncExternalStore(subscribeVoiceSettings, getVoiceSettings, () => SERVER_SETTINGS);
  return [settings, setVoiceSettings];
}

export interface VoiceInfo {
  supported: boolean;
  /** Null while the voice list is still loading. */
  picked: PickedVoice<SpeechSynthesisVoice> | null;
}

/** Which voice will speak, for the settings sheet. */
export function useVoiceInfo(active: boolean): VoiceInfo {
  const [picked, setPicked] = useState<PickedVoice<SpeechSynthesisVoice> | null>(null);
  const supported = hasSpeech();
  useEffect(() => {
    if (!active || !supported) return;
    let cancelled = false;
    currentVoice().then((p) => {
      if (!cancelled) setPicked(p);
    });
    return () => {
      cancelled = true;
    };
  }, [active, supported]);
  return { supported, picked };
}
