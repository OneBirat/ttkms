/**
 * speak.ts against fake browser APIs: every entry point must resolve quietly
 * when speechSynthesis is missing, voices never load, the engine reports an
 * error, the utterance constructor throws, or localStorage throws - and the
 * scan → save chain must still succeed around a failing speak().
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { scanMark } from "../mock/mockApi";
import {
  SPEECH,
  VOICES_TIMEOUT_MS,
  beep,
  getSpeechStatus,
  getVoiceSettings,
  loadVoices,
  resetSpeechForTests,
  setVoiceSettings,
  speak,
  unlockAudio,
} from "../speak";

type Listener = () => void;

interface FakeUtterance {
  text: string;
  voice: unknown;
  lang: string;
  rate: number;
  pitch: number;
  volume: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}

interface FakeSynth {
  speaking: boolean;
  pending: boolean;
  spoken: FakeUtterance[];
  cancelled: number;
  getVoices: () => { lang: string; name: string; default?: boolean }[];
  addEventListener: (type: string, fn: Listener) => void;
  removeEventListener: (type: string, fn: Listener) => void;
  speak: (u: FakeUtterance) => void;
  cancel: () => void;
  resume: () => void;
}

const g = globalThis as unknown as Record<string, unknown>;

function installSynth(options: {
  voices?: { lang: string; name: string; default?: boolean }[];
  onSpeak?: (u: FakeUtterance, synth: FakeSynth) => void;
  utteranceThrows?: boolean;
  speakThrows?: boolean;
} = {}): FakeSynth {
  const synth: FakeSynth = {
    speaking: false,
    pending: false,
    spoken: [],
    cancelled: 0,
    getVoices: () => options.voices ?? [],
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    speak(u) {
      if (options.speakThrows) throw new Error("speak() refused");
      synth.spoken.push(u);
      (options.onSpeak ?? ((x) => setTimeout(() => x.onend?.(), 0)))(u, synth);
    },
    cancel() {
      synth.cancelled += 1;
    },
    resume() {
      /* no-op */
    },
  };
  g.window = { speechSynthesis: synth };
  g.SpeechSynthesisUtterance = class {
    text: string;
    voice: unknown = null;
    lang = "";
    rate = 1;
    pitch = 1;
    volume = 1;
    onstart = null;
    onend = null;
    onerror = null;
    constructor(text: string) {
      if (options.utteranceThrows) throw new Error("no utterances here");
      this.text = text;
    }
  };
  return synth;
}

function uninstall(): void {
  delete g.window;
  delete g.SpeechSynthesisUtterance;
  delete g.localStorage;
  delete g.navigator;
  resetSpeechForTests();
}

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const kamala = { name: "Kamala Bhandari", name_ne: "कमला भण्डारी" };

afterEach(uninstall);

describe("speech without a browser", () => {
  it("speak, beep and unlockAudio are quiet no-ops when speechSynthesis is undefined", async () => {
    resetSpeechForTests();
    await speak(SPEECH.present());
    assert.equal(getSpeechStatus().outcome, "unsupported");
    assert.doesNotThrow(() => beep("ok"));
    assert.doesNotThrow(() => beep("error"));
    assert.doesNotThrow(() => unlockAudio());
    assert.deepEqual(await loadVoices(), []);
  });
});

describe("speech with a fake engine", () => {
  it("speaks Nepali with a Hindi voice and reports success", async () => {
    const synth = installSynth({ voices: [{ lang: "hi-IN", name: "Lekha" }] });
    await speak(SPEECH.name(kamala));
    await tick();
    assert.equal(synth.spoken.length, 1);
    assert.equal(synth.spoken[0].text, "कमला भण्डारी");
    assert.equal(synth.spoken[0].lang, "hi-IN");
    assert.equal(getSpeechStatus().outcome, "spoke");
  });

  it("falls back to the English line when only an English voice exists", async () => {
    const synth = installSynth({ voices: [{ lang: "en-US", name: "Samantha", default: true }] });
    await speak(SPEECH.overtime(2));
    assert.equal(synth.spoken[0].text, "present, overtime 2 hours");
  });

  it("gives up quietly (beep only) when voices never load", async () => {
    const synth = installSynth({ voices: [] });
    const started = Date.now();
    await speak(SPEECH.present());
    assert.ok(Date.now() - started >= VOICES_TIMEOUT_MS - 50);
    assert.equal(synth.spoken.length, 0);
    assert.equal(getSpeechStatus().outcome, "no-voice");
  });

  it("treats an engine error as a status, never a throw, and ignores 'interrupted'", async () => {
    const synth = installSynth({
      voices: [{ lang: "ne-NP", name: "Nepali" }],
      onSpeak: (u) => setTimeout(() => u.onerror?.({ error: "synthesis-failed" }), 0),
    });
    await speak(SPEECH.already(kamala));
    await tick();
    assert.equal(getSpeechStatus().outcome, "error");
    assert.equal(getSpeechStatus().detail, "synthesis-failed");
    synth.spoken.length = 0;
    const quiet = installSynth({
      voices: [{ lang: "ne-NP", name: "Nepali" }],
      onSpeak: (u) => setTimeout(() => u.onerror?.({ error: "interrupted" }), 0),
    });
    resetSpeechForTests();
    await speak(SPEECH.unknown());
    await tick();
    assert.equal(quiet.spoken.length, 1);
    assert.equal(getSpeechStatus().outcome, "idle");
  });

  it("resolves when the utterance constructor or speak() throws", async () => {
    installSynth({ voices: [{ lang: "ne-NP", name: "Nepali" }], utteranceThrows: true });
    await speak(SPEECH.present());
    assert.equal(getSpeechStatus().outcome, "error");
    uninstall();
    installSynth({ voices: [{ lang: "ne-NP", name: "Nepali" }], speakThrows: true });
    await speak(SPEECH.present());
    assert.equal(getSpeechStatus().outcome, "error");
    assert.equal(getSpeechStatus().detail, "speak() refused");
  });

  it("cancels what is still being said before the next scan speaks", async () => {
    const synth = installSynth({
      voices: [{ lang: "ne-NP", name: "Nepali" }],
      onSpeak: (u, s) => {
        s.speaking = true;
        setTimeout(() => {
          s.speaking = false;
          u.onend?.();
        }, 500);
      },
    });
    void speak(SPEECH.name(kamala));
    await tick(20);
    await speak(SPEECH.name({ name: "Laxmi Karki" }));
    assert.equal(synth.cancelled, 1);
    assert.equal(synth.spoken.length, 2);
  });

  it("does nothing while the setting is off, except a forced test", async () => {
    const synth = installSynth({ voices: [{ lang: "ne-NP", name: "Nepali" }] });
    setVoiceSettings({ enabled: false });
    await speak(SPEECH.present());
    beep("ok");
    assert.equal(synth.spoken.length, 0);
    await speak(SPEECH.test(), { force: true });
    assert.equal(synth.spoken.length, 1);
  });

  it("marks audio unavailable when the unlock throws", () => {
    installSynth({ utteranceThrows: true });
    assert.doesNotThrow(() => unlockAudio());
    assert.equal(getSpeechStatus().audio, "unavailable");
  });
});

describe("settings storage", () => {
  it("survives a localStorage that throws", () => {
    g.localStorage = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    resetSpeechForTests();
    assert.deepEqual(getVoiceSettings(), { enabled: true, rate: 0.95 });
    assert.doesNotThrow(() => setVoiceSettings({ rate: 1.1 }));
    assert.equal(getVoiceSettings().rate, 1.1);
  });
});

describe("scan still saves when speech fails", () => {
  it("the scan → save chain resolves around a failing speak()", async () => {
    installSynth({ voices: [{ lang: "ne-NP", name: "Nepali" }], speakThrows: true });
    let saved = false;
    await scanMark({ employee_id: 5, code: "E-005", action: "present", ot_hours: 0 })
      .then((result) => {
        saved = result.record.status === "P";
        void speak(SPEECH.present());
      })
      .catch(() => {
        saved = false;
      });
    await tick();
    assert.equal(saved, true);
    assert.equal(getSpeechStatus().outcome, "error");
  });
});
