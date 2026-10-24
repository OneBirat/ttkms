import { test } from "node:test";
import assert from "node:assert/strict";
import { hasDevanagari, nepaliSuggestion, transliterateName, transliterateWord } from "../_lib/devanagari.ts";

test("dictionary names keep their usual spelling", () => {
  assert.equal(transliterateName("Anita Gurung"), "अनिता गुरुङ");
  assert.equal(transliterateName("Bikash Shrestha"), "बिकास श्रेष्ठ");
  assert.equal(transliterateName("Laxmi Karki"), "लक्ष्मी कार्की");
  assert.equal(transliterateName("Hari Bahadur Bk"), "हरि बहादुर बि.क.");
  assert.equal(transliterateName("Ramesh K.C."), "रमेश के.सी.");
  assert.equal(transliterateName("Krishna Khadka"), "कृष्ण खड्का");
});

test("rules: inherent a, final a, final i, long vowels, conjuncts", () => {
  assert.equal(transliterateWord("Pramila"), "प्रमिला");
  assert.equal(transliterateWord("Umesh"), "उमेश");
  assert.equal(transliterateWord("Nirmala"), "निर्मला");
  assert.equal(transliterateWord("Mandira"), "मन्दिरा");
  assert.equal(transliterateWord("Sunil"), "सुनिल");
  assert.equal(transliterateWord("Rupa"), "रुपा");
  assert.equal(transliterateWord("Meena"), "मीना");
  assert.equal(transliterateWord("Roshan"), "रोशन");
  assert.equal(transliterateWord("Kabita"), "कबिता");
  assert.equal(transliterateWord("Jasmine"), "जस्मिने");
});

test("ng is ङ at the end or before a consonant, न+ग before a vowel", () => {
  assert.equal(transliterateWord("Tamang"), "तामाङ");
  assert.equal(transliterateWord("Rangita"), "रङ्गिता");
  assert.equal(transliterateWord("Sangam"), "सङ्गम");
});

test("vocalic r and initial vowels", () => {
  assert.equal(transliterateWord("Prithvi"), "पृथ्वी");
  assert.equal(transliterateWord("Ishwar"), "इश्वर");
  assert.equal(transliterateWord("Asha"), "अशा");
});

test("empty, punctuation and non-letters", () => {
  assert.equal(transliterateName(""), "");
  assert.equal(transliterateName("   "), "");
  assert.equal(transliterateName("E-026"), "ए");
  assert.ok(hasDevanagari("अनिता"));
  assert.ok(!hasDevanagari("Anita"));
});

test("suggestion only while the Nepali field is empty", () => {
  assert.equal(nepaliSuggestion("Anita Gurung", ""), "अनिता गुरुङ");
  assert.equal(nepaliSuggestion("Anita Gurung", "   "), "अनिता गुरुङ");
  assert.equal(nepaliSuggestion("Anita Gurung", "अनिता"), null);
  assert.equal(nepaliSuggestion("Anita Gurung", "x"), null);
  assert.equal(nepaliSuggestion("", ""), null);
  assert.equal(nepaliSuggestion("अनिता गुरुङ", ""), null);
});
