import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_VOICE_SETTINGS,
  SPEECH,
  clampRate,
  parseSettings,
  pickVoice,
  spokenName,
  voiceStatusText,
} from "../speak";

const voices = [
  { lang: "en-US", name: "Samantha", default: true },
  { lang: "hi-IN", name: "Lekha" },
  { lang: "ne-NP", name: "Nepali" },
];

describe("voice picking", () => {
  it("prefers Nepali, then Hindi, then the default", () => {
    assert.equal(pickVoice(voices).voice?.name, "Nepali");
    assert.equal(pickVoice(voices).kind, "nepali");
    assert.equal(pickVoice(voices.slice(0, 2)).kind, "hindi");
    assert.equal(pickVoice(voices.slice(0, 1)).kind, "default");
    assert.equal(pickVoice([]).kind, "none");
    assert.equal(pickVoice([{ lang: "ne_NP", name: "x" }]).kind, "nepali");
  });
  it("describes the voice in use", () => {
    assert.equal(voiceStatusText(pickVoice(voices)), "Nepali voice ✓");
    assert.match(voiceStatusText(pickVoice(voices.slice(0, 2))), /Hindi voice/);
    assert.equal(voiceStatusText(pickVoice([])), "No voice found");
  });
});

describe("voice settings", () => {
  it("parses stored JSON and falls back to the defaults", () => {
    assert.deepEqual(parseSettings(null), DEFAULT_VOICE_SETTINGS);
    assert.deepEqual(parseSettings("nonsense"), DEFAULT_VOICE_SETTINGS);
    assert.deepEqual(parseSettings('{"enabled":false,"rate":1.1}'), { enabled: false, rate: 1.1 });
    assert.deepEqual(parseSettings('{"rate":5}'), { enabled: true, rate: 1.2 });
  });
  it("clamps the rate to 0.7–1.2", () => {
    assert.equal(clampRate(0.1), 0.7);
    assert.equal(clampRate(3), 1.2);
    assert.equal(clampRate(Number.NaN), 0.95);
  });
});

describe("what to say", () => {
  it("uses the Nepali spelling when there is one", () => {
    assert.equal(spokenName({ name: "Kamala Bhandari", name_ne: "कमला भण्डारी" }), "कमला भण्डारी");
    assert.equal(spokenName({ name: "Kamala Bhandari", name_ne: "" }), "Kamala Bhandari");
    assert.equal(spokenName({ name: "Kamala Bhandari" }), "Kamala Bhandari");
  });
  it("builds the sentences with Nepali digits and an English fallback", () => {
    const kamala = { name: "Kamala Bhandari", name_ne: "कमला भण्डारी" };
    assert.deepEqual(SPEECH.name(kamala), { np: "कमला भण्डारी", en: "Kamala Bhandari" });
    assert.deepEqual(SPEECH.present(kamala), { np: "कमला भण्डारी, हाजिर", en: "Kamala Bhandari, present" });
    assert.equal(SPEECH.overtime(kamala, 2).np, "कमला भण्डारी, हाजिर, ओभरटाइम २ घण्टा");
    assert.equal(SPEECH.overtime(kamala, 1).en, "Kamala Bhandari, present, overtime 1 hour");
    assert.equal(SPEECH.already(kamala).np, "कमला भण्डारी, आज हाजिर भइसक्यो");
    assert.equal(SPEECH.payment(kamala, "advance", 2000).np, "कमला भण्डारी, पेश्की रु २,००० भुक्तानी भयो");
    assert.equal(SPEECH.payment(kamala, "salary", 18693).np, "कमला भण्डारी, तलब रु १८,६९३ भुक्तानी भयो");
    assert.equal(SPEECH.payment(kamala, "salary", 18693).en, "Kamala Bhandari, salary of 18,693 rupees recorded");
    assert.equal(SPEECH.present({ name: "Ram Thapa" }).np, "Ram Thapa, हाजिर");
    assert.deepEqual(SPEECH.unknown(), { np: "कार्ड भेटिएन", en: "Card not found" });
    assert.equal(SPEECH.test().np, "कमला भण्डारी, हाजिर");
  });
});
