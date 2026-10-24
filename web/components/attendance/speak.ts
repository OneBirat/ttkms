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
  try {
    return (
      typeof window !== "undefined" &&
      "speechSynthesis" in window &&
      !!window.speechSynthesis &&
      typeof SpeechSynthesisUtterance !== "undefined"
    );
  } catch {
    return false;
  }
}

let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;

/** How long to wait for the voice list before speech gives up (beep only). */
export const VOICES_TIMEOUT_MS = 2000;

/**
 * getVoices(); when the list is still empty (iOS/Android fill it late) waits
 * for "voiceschanged", at most 2 s. Cached; a later "voiceschanged" refreshes.
 */
export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!hasSpeech()) return Promise.resolve([]);
  if (voicesPromise) return voicesPromise;
  const synth = window.speechSynthesis;
  const list = (): SpeechSynthesisVoice[] => {
    try {
      return synth.getVoices() ?? [];
    } catch {
      return [];
    }
  };
  voicesPromise = new Promise<SpeechSynthesisVoice[]>((resolve) => {
    const now = list();
    if (now.length) {
      resolve(now);
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        synth.removeEventListener?.("voiceschanged", finish);
      } catch {
        // Fine.
      }
      resolve(list());
    };
    try {
      synth.addEventListener?.("voiceschanged", finish);
    } catch {
      // Fine: the timeout resolves it.
    }
    setTimeout(finish, VOICES_TIMEOUT_MS);
  });
  // Voices installed later (e.g. after the help steps) replace the cache.
  try {
    synth.addEventListener?.("voiceschanged", () => {
      voicesPromise = Promise.resolve(list());
    });
  } catch {
    // Fine.
  }
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

export type AudioAvailability = "unknown" | "ok" | "unavailable";

export interface SpeechStatus {
  /** What happened to the last utterance, for the settings sheet. */
  outcome: "idle" | "queued" | "speaking" | "spoke" | "error" | "unsupported" | "no-voice";
  text: string;
  voice: string;
  detail: string;
  /** Set by unlockAudio(): "unavailable" when the device refused audio/speech on the first tap. */
  audio: AudioAvailability;
  at: number;
}

const IDLE: SpeechStatus = { outcome: "idle", text: "", voice: "", detail: "", audio: "unknown", at: 0 };
let status: SpeechStatus = IDLE;
const statusListeners = new Set<() => void>();

function setStatus(patch: Partial<SpeechStatus>): void {
  status = { ...status, ...patch, at: Date.now() };
  statusListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // A listener must never break speech.
    }
  });
}

export function getSpeechStatus(): SpeechStatus {
  return status;
}

export function subscribeSpeechStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function warn(message: string, err?: unknown): void {
  try {
    console.warn(`[attendance voice] ${message}`, err ?? "");
  } catch {
    // Even logging is optional here.
  }
}

let sequence = 0;
// Chrome garbage-collects an utterance that nothing references and then stops it mid-word.
let lastUtterance: SpeechSynthesisUtterance | null = null;
let watchdog: ReturnType<typeof setTimeout> | null = null;

/** An utterance that has not ended after this long is cancelled (engine wedged). */
export const WATCHDOG_MS = 5000;

/** Errors the engine reports when we cancel on purpose (a newer scan); not worth a warning. */
const EXPECTED_ERRORS = new Set(["interrupted", "canceled", "cancelled"]);

function clearWatchdog(): void {
  if (watchdog) clearTimeout(watchdog);
  watchdog = null;
}

export function stopSpeaking(): void {
  clearWatchdog();
  try {
    if (hasSpeech()) window.speechSynthesis.cancel();
  } catch {
    // Nothing was speaking.
  }
}

/** The utterance most recently handed to the engine (kept referenced; useful in devtools). */
export function lastSpokenUtterance(): SpeechSynthesisUtterance | null {
  return lastUtterance;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Says `phrase`. Never throws and never rejects: scanning and saving must not
 * depend on the speech engine. Callers fire and forget (`void speak(...)`).
 */
export async function speak(phrase: Phrase | string, options: { force?: boolean } = {}): Promise<void> {
  try {
    await speakUnsafe(phrase, options);
  } catch (err) {
    warn("speak failed", err);
    try {
      setStatus({ outcome: "error", detail: err instanceof Error ? err.message : "speak failed" });
    } catch {
      // Status is best effort.
    }
  }
}

/**
 * Nepali text with a Nepali or Hindi voice, the English line when the device
 * has neither (an English voice skips Devanagari letters and says nothing);
 * beep only when no voice has loaded at all. Whatever is still being said is
 * cancelled first (fast back-to-back scans must not queue). Nothing happens
 * when the setting is off (unless `force`, used by "Test voice") or speech is
 * missing.
 *
 * Mobile quirks handled: speak() right after cancel() is dropped on Android
 * Chrome and iOS, so there is a short pause between them; iOS pauses the
 * engine after backgrounding, so resume() follows speak(); a 5 s watchdog
 * cancels an utterance whose end never comes.
 */
async function speakUnsafe(phrase: Phrase | string, options: { force?: boolean }): Promise<void> {
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
    stopSpeaking();
    await delay(80);
  }
  const { voice, kind } = pickVoice(await loadVoices());
  if (mine !== sequence) return; // a newer scan spoke meanwhile
  if (kind === "none") {
    // Voices never loaded (2 s): the beep already confirmed the scan; say so in settings.
    setStatus({ outcome: "no-voice", text: p.np, voice: "", detail: "No voices loaded — beep only" });
    return;
  }
  const devanagari = kind === "nepali" || kind === "hindi";
  const text = devanagari ? p.np : p.en;
  const utterance = new SpeechSynthesisUtterance(text);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }
  utterance.rate = clampRate(settings.rate);
  utterance.pitch = 1;
  utterance.volume = 1;
  const voiceName = voice ? `${voice.name} (${voice.lang})` : "engine default";
  const finish = (patch: Partial<SpeechStatus>) => {
    if (lastUtterance === utterance) clearWatchdog();
    setStatus({ text, voice: voiceName, ...patch });
  };
  utterance.onstart = () => setStatus({ outcome: "speaking", text, voice: voiceName, detail: "" });
  utterance.onend = () => finish({ outcome: "spoke", detail: "" });
  utterance.onerror = (event) => {
    const code = event?.error || "unknown error";
    if (EXPECTED_ERRORS.has(code)) {
      finish({ outcome: "idle", detail: "" });
      return;
    }
    warn(`utterance error: ${code}`);
    finish({ outcome: "error", detail: code });
  };
  lastUtterance = utterance;
  setStatus({ outcome: "queued", text, voice: voiceName, detail: "" });
  synth.speak(utterance);
  try {
    synth.resume();
  } catch {
    // Not every engine implements resume().
  }
  clearWatchdog();
  watchdog = setTimeout(() => {
    if (lastUtterance !== utterance) return;
    warn("utterance did not end; cancelling");
    try {
      synth.cancel();
    } catch {
      // Nothing to cancel.
    }
    setStatus({ outcome: "error", text, voice: voiceName, detail: "timed out" });
  }, WATCHDOG_MS);
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

/** ok = one short high tone; skip = one short low tone; error = two low tones. Silent when off. Never throws. */
export function beep(kind: "ok" | "error" | "skip"): void {
  try {
    if (!getVoiceSettings().enabled) return;
    vibrate(kind === "ok" ? 40 : kind === "skip" ? 30 : [60, 60, 60]);
    const ctx = getAudio();
    if (!ctx) return;
    const play = () => {
      try {
        const t = ctx.currentTime;
        if (kind === "ok") {
          tone(ctx, 1046, t, 0.12);
        } else if (kind === "skip") {
          tone(ctx, 330, t, 0.1);
        } else {
          tone(ctx, 220, t, 0.15);
          tone(ctx, 220, t + 0.2, 0.15);
        }
      } catch (err) {
        warn("beep failed", err);
      }
    };
    // A context created before any tap is suspended on phones: play once it is running.
    if (ctx.state === "suspended") ctx.resume().then(play, () => undefined);
    else play();
  } catch (err) {
    warn("beep failed", err);
  }
}

/**
 * iOS/Safari allow speech and audio only after a user tap: call this from the
 * first tap on "Scan staff card" so the scans that follow can talk.
 */
export function unlockAudio(): void {
  try {
    const ctx = getAudio();
    if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    if (!hasSpeech()) {
      if (status.audio === "unknown") setStatus({ audio: ctx ? "ok" : "unavailable" });
      return;
    }
    const synth = window.speechSynthesis;
    if (!(synth.speaking || synth.pending)) {
      // iOS skips an empty utterance; a single space at volume 0 counts as the first speak().
      const silent = new SpeechSynthesisUtterance(" ");
      silent.volume = 0;
      silent.rate = 2;
      lastUtterance = silent;
      synth.speak(silent);
      try {
        synth.resume();
      } catch {
        // Optional.
      }
    }
    void loadVoices(); // iOS fills the voice list after the first speak()
    if (status.audio !== "ok") setStatus({ audio: "ok" });
  } catch (err) {
    warn("audio unlock failed", err);
    setStatus({ audio: "unavailable" });
  }
}

/** Test hook: forget cached voices, settings, status and the audio context. */
export function resetSpeechForTests(): void {
  voicesPromise = null;
  current = null;
  status = IDLE;
  audio = null;
  lastUtterance = null;
  clearWatchdog();
  sequence = 0;
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
  /** The name was already said when the card was read, so the confirmation is just the status. */
  present: (): Phrase => ({ np: "हाजिर", en: "present" }),
  absent: (): Phrase => ({ np: "अनुपस्थित", en: "absent" }),
  overtime: (hours: number): Phrase => ({
    np: `हाजिर, ओभरटाइम ${toDevanagariDigits(hours)} घण्टा`,
    en: `present, overtime ${hours} ${hours === 1 ? "hour" : "hours"}`,
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
  test: (): Phrase => ({ np: "कमला भण्डारी, हाजिर", en: "Kamala Bhandari, present" }), // name + status, as a scan sounds
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
