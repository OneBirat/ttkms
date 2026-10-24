"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  currentVoice,
  getVoiceSettings,
  hasSpeech,
  setVoiceSettings,
  subscribeVoiceSettings,
  type PickedVoice,
  type VoiceSettings,
} from "./speak";

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
