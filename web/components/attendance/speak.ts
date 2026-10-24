/**
 * Spoken confirmation for the scan flow, on the browser's Web Speech API
 * (window.speechSynthesis) and a WebAudio beep: free, offline, no packages.
 *
 * Voice: the first Nepali voice (ne-NP), else Hindi (hi-IN), else the default.
 * Settings live in localStorage under "ttk.scanVoice" ({enabled, rate}); every
 * read/write is wrapped so a blocked storage never breaks the screen. All
 * functions are no-ops where speechSynthesis / AudioContext are missing, so
 * the flow is silent, not broken, on an unsupported browser.
 *
 * Pure parts (pickVoice, parseSettings, the texts) have no window access and
 * are unit-tested in __tests__/speak.test.ts.
 */

import { toDevanagariDigits } from "./bsdate";
import { formatAmount } from "./helpers";
import type { PaymentType } from "./types";

// ------------------------------------------------------------ settings

export interface VoiceSettings {
  enabled: boolean;
  /** Speech rate, 0.7–1.2. */
  rate: number;
}

export const VOICE_SETTINGS_KEY = "ttk.scanVoice";
export const DEFAULT_VOICE_SETTINGS: VoiceSettings = { enabled: true, rate: 0.95 };
export const RATE_MIN = 0.7;
export const RATE_MAX = 1.2;

export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return DEFAULT_VOICE_SETTINGS.rate;
  return Math.min(RATE_MAX, Math.max(RATE_MIN, Math.round(rate * 100) / 100));
}

/** Parses the stored JSON; anything odd falls back to the defaults. */
export function parseSettings(raw: string | null | undefined): VoiceSettings {
  if (!raw) return { ...DEFAULT_VOICE_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<VoiceSettings> | null;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_VOICE_SETTINGS };
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_VOICE_SETTINGS.enabled,
      rate: typeof parsed.rate === "number" ? clampRate(parsed.rate) : DEFAULT_VOICE_SETTINGS.rate,
    };
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

function readStoredSettings(): VoiceSettings {
  try {
    return parseSettings(typeof localStorage === "undefined" ? null : localStorage.getItem(VOICE_SETTINGS_KEY));
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

function writeStoredSettings(settings: VoiceSettings): void {
  try {
    localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked (private mode, quota): the setting still applies to this page.
  }
}

// A tiny store so the camera header toggle, the desktop toggle and the settings
// sheet all show the same state (useSyncExternalStore in useVoice.ts).
let current: VoiceSettings | null = null;
const listeners = new Set<() => void>();

export function getVoiceSettings(): VoiceSettings {
  if (!current) current = readStoredSettings();
  return current;
}

export function setVoiceSettings(patch: Partial<VoiceSettings>): VoiceSettings {
  const next = { ...getVoiceSettings(), ...patch };
  next.rate = clampRate(next.rate);
  current = next;
  writeStoredSettings(next);
  if (!next.enabled) stopSpeaking();
  listeners.forEach((fn) => fn());
  return next;
}

export function subscribeVoiceSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ------------------------------------------------------------ voices

export type VoiceKind = "nepali" | "hindi" | "default" | "none";

/** The subset of SpeechSynthesisVoice the picker needs (testable without a browser). */
export interface VoiceLike {
  lang: string;
  name: string;
  default?: boolean;
}

export interface PickedVoice<T extends VoiceLike> {
  voice: T | null;
  kind: VoiceKind;
}

const langIs = (voice: VoiceLike, prefix: string) =>
  voice.lang.toLowerCase().replace("_", "-").startsWith(prefix);

/** First Nepali voice, else Hindi, else the default voice, else none. */
export function pickVoice<T extends VoiceLike>(voices: readonly T[]): PickedVoice<T> {
  const nepali = voices.find((v) => langIs(v, "ne"));
  if (nepali) return { voice: nepali, kind: "nepali" };
  const hindi = voices.find((v) => langIs(v, "hi"));
  if (hindi) return { voice: hindi, kind: "hindi" };
  const fallback = voices.find((v) => v.default) ?? voices[0] ?? null;
  return { voice: fallback, kind: fallback ? "default" : "none" };
}

export function hasSpeech(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;

/**
 * getVoices(); when the list is still empty (iOS/Android fill it late) waits
 * for "voiceschanged", at most 2 s. Cached; a later "voiceschanged" refreshes.
 */
export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!hasSpeech()) return Promise.resolve([]);
  if (voicesPromise) return voicesPromise;
  const synth = window.speechSynthesis;
  voicesPromise = new Promise<SpeechSynthesisVoice[]>((resolve) => {
    const now = synth.getVoices();
    if (now.length) {
      resolve(now);
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      synth.removeEventListener("voiceschanged", finish);
      resolve(synth.getVoices());
    };
    synth.addEventListener("voiceschanged", finish);
    setTimeout(finish, 2000);
  });
  // Voices installed later (e.g. after the help steps) replace the cache.
  synth.addEventListener("voiceschanged", () => {
    voicesPromise = Promise.resolve(synth.getVoices());
  });
  return voicesPromise;
}

/** Which voice the scan flow will use, for the settings sheet. */
export async function currentVoice(): Promise<PickedVoice<SpeechSynthesisVoice>> {
  return pickVoice(await loadVoices());
}

// ------------------------------------------------------------ speaking

/** A sentence in Nepali plus an English fallback for devices without a Devanagari voice. */
export interface Phrase {
  np: string;
  en: string;
}

export interface SpeechStatus {
  /** What happened to the last utterance, for the settings sheet. */
  outcome: "idle" | "queued" | "speaking" | "spoke" | "error" | "unsupported" | "no-voice";
  text: string;
  voice: string;
  detail: string;
  at: number;
}

let status: SpeechStatus = { outcome: "idle", text: "", voice: "", detail: "", at: 0 };
const statusListeners = new Set<() => void>();

function setStatus(patch: Partial<SpeechStatus>): void {
  status = { ...status, ...patch, at: Date.now() };
  statusListeners.forEach((fn) => fn());
}

export function getSpeechStatus(): SpeechStatus {
  return status;
}

export function subscribeSpeechStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

let sequence = 0;
// Chrome garbage-collects an utterance that nothing references and then stops it mid-word.
let lastUtterance: SpeechSynthesisUtterance | null = null;

export function stopSpeaking(): void {
  if (hasSpeech()) window.speechSynthesis.cancel();
}

/** The utterance most recently handed to the engine (kept referenced; useful in devtools). */
export function lastSpokenUtterance(): SpeechSynthesisUtterance | null {
  return lastUtterance;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Says `phrase` with the picked voice: Nepali text with a Nepali or Hindi
 * voice, the English line when the device has neither (an English voice skips
 * Devanagari letters and says nothing). Whatever is still being said is
 * cancelled first (fast back-to-back scans must not queue). Nothing happens
 * when the setting is off (unless `force`, used by "Test voice") or speech is
 * missing.
 *
 * Mobile quirks handled: speak() right after cancel() is dropped on Android
 * Chrome and iOS, so there is a short pause between them; iOS pauses the
 * engine after backgrounding, so resume() follows speak().
 */
export async function speak(phrase: Phrase | string, options: { force?: boolean } = {}): Promise<void> {
  const p: Phrase = typeof phrase === "string" ? { np: phrase, en: phrase } : phrase;
  if (!hasSpeech()) {
    setStatus({ outcome: "unsupported", text: p.np, voice: "", detail: "No speechSynthesis in this browser" });
    return;
  }
  const settings = getVoiceSettings();
  if (!settings.enabled && !options.force) return;
  const mine = ++sequence;
  const synth = window.speechSynthesis;
  if (synth.speaking || synth.pending) {
    synth.cancel();
    await delay(80);
  }
  const { voice, kind } = pickVoice(await loadVoices());
  if (mine !== sequence) return; // a newer scan spoke meanwhile
  const devanagari = kind === "nepali" || kind === "hindi";
  const text = devanagari ? p.np : p.en;
  const utterance = new SpeechSynthesisUtterance(text);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    // No voice list (iOS before the first speak): let the engine pick one for Hindi,
    // which reads Devanagari; English text goes to the default voice.
    utterance.lang = devanagari ? "hi-IN" : "en-US";
  }
  utterance.rate = clampRate(settings.rate);
  utterance.pitch = 1;
  utterance.volume = 1;
  const voiceName = voice ? `${voice.name} (${voice.lang})` : `engine default (${utterance.lang})`;
  utterance.onstart = () => setStatus({ outcome: "speaking", text, voice: voiceName, detail: "" });
  utterance.onend = () => setStatus({ outcome: "spoke", text, voice: voiceName, detail: "" });
  utterance.onerror = (event) =>
    setStatus({ outcome: "error", text, voice: voiceName, detail: event.error || "unknown error" });
  lastUtterance = utterance;
  setStatus({ outcome: "queued", text, voice: voiceName, detail: kind === "none" ? "no voice listed" : "" });
  try {
    synth.speak(utterance);
    synth.resume();
  } catch (err) {
    setStatus({ outcome: "error", text, voice: voiceName, detail: err instanceof Error ? err.message : "speak() threw" });
  }
}

/** Android haptic tap alongside the beep (no-op elsewhere). */
function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(pattern);
  } catch {
    // Not available.
  }
}

// ------------------------------------------------------------ beep (WebAudio)

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { webkitAudioContext?: AudioContextCtor };
  return window.AudioContext ?? w.webkitAudioContext ?? null;
}

let audio: AudioContext | null = null;

function getAudio(): AudioContext | null {
  if (audio) return audio;
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  try {
    audio = new Ctor();
  } catch {
    audio = null;
  }
  return audio;
}

function tone(ctx: AudioContext, frequency: number, start: number, duration: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.25, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/** ok = one short high tone; error = two low tones. Silent when the setting is off. */
export function beep(kind: "ok" | "error"): void {
  if (!getVoiceSettings().enabled) return;
  vibrate(kind === "ok" ? 40 : [60, 60, 60]);
  const ctx = getAudio();
  if (!ctx) return;
  const play = () => {
    const t = ctx.currentTime;
    try {
      if (kind === "ok") {
        tone(ctx, 1046, t, 0.12);
      } else {
        tone(ctx, 220, t, 0.15);
        tone(ctx, 220, t + 0.2, 0.15);
      }
    } catch {
      // No sound rather than a broken scan.
    }
  };
  // A context created before any tap is suspended on phones: play once it is running.
  if (ctx.state === "suspended") ctx.resume().then(play, () => undefined);
  else play();
}

/**
 * iOS/Safari allow speech and audio only after a user tap: call this from the
 * first tap on "Scan staff card" so the scans that follow can talk.
 */
export function unlockAudio(): void {
  const ctx = getAudio();
  if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  if (!hasSpeech()) return;
  try {
    const synth = window.speechSynthesis;
    if (synth.speaking || synth.pending) return; // already unlocked and busy
    // iOS skips an empty utterance; a single space at volume 0 counts as the first speak().
    const silent = new SpeechSynthesisUtterance(" ");
    silent.volume = 0;
    silent.rate = 2;
    lastUtterance = silent;
    synth.speak(silent);
    synth.resume();
    void loadVoices(); // iOS fills the voice list after the first speak()
  } catch {
    // Nothing to unlock.
  }
}

// ------------------------------------------------------------ what to say

/** Nepali spelling when payroll has one, else the Latin name. */
export function spokenName(employee: { name: string; name_ne?: string | null }): string {
  return employee.name_ne?.trim() || employee.name;
}

type Named = { name: string; name_ne?: string | null };

export const SPEECH = {
  /** Said the moment a card is read, before any marking: just who it is. */
  name: (e: Named): Phrase => ({ np: spokenName(e), en: e.name }),
  present: (e: Named): Phrase => ({ np: `${spokenName(e)}, हाजिर`, en: `${e.name}, present` }),
  overtime: (e: Named, hours: number): Phrase => ({
    np: `${spokenName(e)}, हाजिर, ओभरटाइम ${toDevanagariDigits(hours)} घण्टा`,
    en: `${e.name}, present, overtime ${hours} ${hours === 1 ? "hour" : "hours"}`,
  }),
  already: (e: Named): Phrase => ({
    np: `${spokenName(e)}, आज हाजिर भइसक्यो`,
    en: `${e.name}, already marked today`,
  }),
  payment: (e: Named, type: PaymentType, amount: number): Phrase => ({
    np: `${spokenName(e)}, ${type === "advance" ? "पेश्की" : "तलब"} रु ${toDevanagariDigits(formatAmount(amount))} भुक्तानी भयो`,
    en: `${e.name}, ${type === "advance" ? "advance" : "salary"} of ${formatAmount(amount)} rupees recorded`,
  }),
  unknown: (): Phrase => ({ np: "कार्ड भेटिएन", en: "Card not found" }),
  test: (): Phrase => ({ np: "कमला भण्डारी, हाजिर", en: "Kamala Bhandari, present" }),
} as const;

/** Text for the settings sheet. */
export function voiceStatusText(picked: PickedVoice<VoiceLike>): string {
  switch (picked.kind) {
    case "nepali":
      return "Nepali voice ✓";
    case "hindi":
      return "Using Hindi voice — install Nepali for better pronunciation";
    case "default":
      return `No Nepali voice — using ${picked.voice?.name ?? "the default voice"}`;
    default:
      return "No voice found";
  }
}
