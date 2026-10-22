/**
 * BS month names, duplicated from web/lib/bsdate.ts so the pure stock
 * helpers (and their node:test unit tests) have no "@/" alias imports.
 * Keep in sync with the shared file.
 */
export const BS_MONTHS_EN = [
  "Baishakh",
  "Jestha",
  "Ashadh",
  "Shrawan",
  "Bhadra",
  "Ashwin",
  "Kartik",
  "Mangsir",
  "Poush",
  "Magh",
  "Falgun",
  "Chaitra",
] as const;

export const BS_MONTHS_NP = [
  "बैशाख",
  "जेठ",
  "असार",
  "साउन",
  "भदौ",
  "असोज",
  "कार्तिक",
  "मंसिर",
  "पुस",
  "माघ",
  "फागुन",
  "चैत",
] as const;
