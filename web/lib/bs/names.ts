/** Month and weekday names of the Bikram Sambat calendar, English and Nepali. */

export type Lang = "en" | "ne";

/** Index 0 = Baisakh. */
export const MONTHS_EN = [
  "Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin",
  "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra",
] as const;

export const MONTHS_NE = [
  "बैशाख", "जेठ", "असार", "साउन", "भदौ", "असोज",
  "कार्तिक", "मंसिर", "पुस", "माघ", "फागुन", "चैत",
] as const;

/** Index 0 = Sunday. */
export const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const WEEKDAYS_SHORT_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const WEEKDAYS_NE = ["आइतबार", "सोमबार", "मंगलबार", "बुधबार", "बिहिबार", "शुक्रबार", "शनिबार"] as const;
export const WEEKDAYS_SHORT_NE = ["आइत", "सोम", "मंगल", "बुध", "बिहि", "शुक्र", "शनि"] as const;
/** Single Nepali initials, Sunday … Saturday (आ सो मं बु बि शु श). */
export const WEEKDAY_INITIALS_NE = ["आ", "सो", "मं", "बु", "बि", "शु", "श"] as const;

export const SUNDAY = 0;
export const SATURDAY = 6;

export const AD_MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
export const AD_MONTHS_SHORT_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function monthName(month: number, lang: Lang = "en"): string {
  if (month < 1 || month > 12) throw new RangeError(`BS month must be 1-12, got ${month}`);
  return (lang === "ne" ? MONTHS_NE : MONTHS_EN)[month - 1];
}

/** "Kar" / "कार्तिक" (Nepali names are not shortened). */
export function monthShort(month: number, lang: Lang = "en"): string {
  const name = monthName(month, lang);
  return lang === "ne" ? name : name.slice(0, 3);
}

/** weekdayName(6) -> "Saturday" / "शनिबार"; out-of-range values wrap like Date#getDay. */
export function weekdayName(weekday: number, lang: Lang = "en"): string {
  return (lang === "ne" ? WEEKDAYS_NE : WEEKDAYS_EN)[((weekday % 7) + 7) % 7];
}

export function weekdayShort(weekday: number, lang: Lang = "en"): string {
  return (lang === "ne" ? WEEKDAYS_SHORT_NE : WEEKDAYS_SHORT_EN)[((weekday % 7) + 7) % 7];
}

/** weekdayInitial(6) -> "श". */
export function weekdayInitial(weekday: number): string {
  return WEEKDAY_INITIALS_NE[((weekday % 7) + 7) % 7];
}
