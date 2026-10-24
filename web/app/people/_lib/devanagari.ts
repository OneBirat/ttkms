/**
 * Romanized Nepali → Devanagari, for suggesting the "Name in Nepali" spelling
 * in the employee forms. Rule-based and local (no API): a small dictionary of
 * common Nepali names and surnames gives the usual spelling, everything else
 * goes through a syllable transliterator. The result is a suggestion the user
 * accepts, edits or ignores; it is never written into a field by itself.
 */

/** Usual spellings that the rules cannot derive (retroflex, long vowels, conjuncts). */
const DICTIONARY: Record<string, string> = {
  // surnames
  acharya: "आचार्य", adhikari: "अधिकारी", ale: "आले", aryal: "अर्याल", basnet: "बस्नेत", bhandari: "भण्डारी",
  bhatta: "भट्ट", bhattarai: "भट्टराई", bhujel: "भुजेल", bista: "बिष्ट", bk: "बि.क.", bogati: "बोगटी",
  chaudhary: "चौधरी", chaudhari: "चौधरी", chhetri: "क्षेत्री", dahal: "दाहाल", dhakal: "ढकाल", gautam: "गौतम",
  ghimire: "घिमिरे", gurung: "गुरुङ", joshi: "जोशी", kafle: "काफ्ले", karki: "कार्की", kc: "के.सी.",
  khadka: "खड्का", khatri: "खत्री", koirala: "कोइराला", lama: "लामा", limbu: "लिम्बु", magar: "मगर",
  maharjan: "महर्जन", mishra: "मिश्र", nepali: "नेपाली", newar: "नेवार", oli: "ओली", pandey: "पाण्डे",
  pant: "पन्त", pariyar: "परियार", paudel: "पौडेल", poudel: "पौडेल", pradhan: "प्रधान", pun: "पुन",
  rai: "राई", rana: "राणा", regmi: "रेग्मी", sapkota: "सापकोटा", shah: "शाह", shahi: "शाही", sharma: "शर्मा",
  sherpa: "शेर्पा", shrestha: "श्रेष्ठ", singh: "सिंह", subedi: "सुवेदी", tamang: "तामाङ", thakuri: "ठकुरी",
  thapa: "थापा", upadhyay: "उपाध्याय", yadav: "यादव",
  // first names and name parts
  anita: "अनिता", anjali: "अञ्जली", bahadur: "बहादुर", bikash: "बिकास", bikas: "बिकास", binod: "बिनोद",
  bir: "बिर", bishnu: "बिष्णु", deepa: "दीपा", devi: "देवी", dinesh: "दिनेश", dipak: "दीपक", ganesh: "गणेश",
  gita: "गीता", gopal: "गोपाल", hari: "हरि", kamala: "कमला", krishna: "कृष्ण", kumar: "कुमार", kumari: "कुमारी",
  laxmi: "लक्ष्मी", man: "मान", manoj: "मनोज", maya: "माया", mina: "मीना", nabin: "नबिन", pooja: "पूजा",
  puja: "पूजा", prakash: "प्रकाश", prasad: "प्रसाद", raj: "राज", rajan: "राजन", rajesh: "राजेश", ram: "राम",
  ramesh: "रमेश", rita: "रीता", sabina: "सबिना", sanjay: "सञ्जय", santosh: "सन्तोष", sarita: "सरिता",
  shyam: "श्याम", sita: "सीता", sunita: "सुनिता", suresh: "सुरेश", sushil: "सुशील", sushila: "सुशीला",
  tek: "टेक",
};

/** Consonants, longest first. */
const CONSONANTS: [string, string][] = [
  ["chh", "छ"], ["ksh", "क्ष"], ["shr", "श्र"], ["kh", "ख"], ["gh", "घ"], ["ch", "च"], ["jh", "झ"], ["th", "थ"],
  ["dh", "ध"], ["ph", "फ"], ["bh", "भ"], ["sh", "श"], ["gy", "ज्ञ"], ["k", "क"], ["g", "ग"], ["c", "च"],
  ["j", "ज"], ["t", "त"], ["d", "द"], ["n", "न"], ["p", "प"], ["b", "ब"], ["m", "म"], ["y", "य"], ["r", "र"],
  ["l", "ल"], ["v", "व"], ["w", "व"], ["s", "स"], ["h", "ह"], ["f", "फ"], ["z", "ज"], ["q", "क"], ["x", "क्ष"],
];

/** Vowels, longest first: [roman, independent letter, matra]. */
const VOWELS: [string, string, string][] = [
  ["aa", "आ", "ा"], ["ee", "ई", "ी"], ["oo", "ऊ", "ू"], ["ai", "ऐ", "ै"], ["au", "औ", "ौ"], ["ou", "औ", "ौ"],
  ["a", "अ", ""], ["i", "इ", "ि"], ["u", "उ", "ु"], ["e", "ए", "े"], ["o", "ओ", "ो"],
];

const VIRAMA = "्";

function matchVowel(word: string, at: number): [string, string, string] | null {
  for (const v of VOWELS) if (word.startsWith(v[0], at)) return v;
  return null;
}

function matchConsonant(word: string, at: number): [string, string] | null {
  for (const c of CONSONANTS) if (word.startsWith(c[0], at)) return c;
  return null;
}

/** One lower-case word (letters only) through the syllable rules. */
export function transliterateWord(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return "";
  const known = DICTIONARY[w];
  if (known) return known;

  let out = "";
  let i = 0;
  let afterConsonant = false; // the last thing written was a bare consonant (inherent "a" pending)
  while (i < w.length) {
    // "ng" is ङ: alone at the end or before a consonant (Gurung, Tamang),
    // ङ्ग before a vowel (Sangam).
    if (w.startsWith("ng", i)) {
      const beforeVowel = i + 2 < w.length && matchVowel(w, i + 2) !== null;
      out += (afterConsonant ? VIRAMA : "") + "ङ" + (beforeVowel ? VIRAMA + "ग" : "");
      afterConsonant = true;
      i += 2;
      continue;
    }
    const vowel = matchVowel(w, i);
    if (vowel) {
      const [roman, letter, matra] = vowel;
      const last = i + roman.length === w.length;
      if (afterConsonant) {
        if (roman === "a") out += last ? "ा" : "";
        else if (roman === "i" && last) out += "ी";
        else out += matra;
      } else {
        out += letter;
      }
      afterConsonant = false;
      i += roman.length;
      continue;
    }
    const consonant = matchConsonant(w, i);
    if (consonant) {
      const [roman, letter] = consonant;
      // consonant + "ri" + consonant: vocalic r (Krishna, Prithvi)
      const vocalicR = roman !== "r" && w.startsWith("ri", i + roman.length) && matchConsonant(w, i + roman.length + 2) !== null && !matchVowel(w, i + roman.length + 2);
      out += (afterConsonant ? VIRAMA : "") + letter;
      if (vocalicR) {
        out += "ृ";
        afterConsonant = false;
        i += roman.length + 2;
      } else {
        afterConsonant = true;
        i += roman.length;
      }
      continue;
    }
    i += 1; // unknown letter: skip
  }
  return out;
}

/**
 * "Anita Gurung" -> "अनिता गुरुङ". Keeps word order; initials with dots such
 * as "K.C." are looked up without the dots. Empty input gives "".
 */
export function transliterateName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => transliterateWord(part))
    .filter(Boolean)
    .join(" ");
}

/** True when the text already contains Devanagari letters. */
export function hasDevanagari(text: string): boolean {
  return /[ऀ-ॿ]/.test(text);
}

/**
 * What the form shows next to an empty "Name in Nepali" field: a suggestion
 * only while the field is empty, never when the user has typed something.
 */
export function nepaliSuggestion(fullName: string, nepaliValue: string): string | null {
  if (nepaliValue.trim() !== "") return null;
  if (hasDevanagari(fullName)) return null;
  const suggestion = transliterateName(fullName);
  return suggestion ? suggestion : null;
}
