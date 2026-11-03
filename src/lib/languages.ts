const names = new Intl.DisplayNames(undefined, { type: "language" });

/** ISO 639-2 codes addons/mpv use (`eng`, `pob`) → 639-1 where we know them. */
export const ISO3: Record<string, string> = {
  eng: "en", spa: "es", spn: "es", fre: "fr", fra: "fr", ger: "de", deu: "de", ita: "it", por: "pt", pob: "pt-BR",
  dut: "nl", nld: "nl", pol: "pl", rus: "ru", tur: "tr", ara: "ar", heb: "he", jpn: "ja", kor: "ko", chi: "zh",
  zho: "zh", swe: "sv", dan: "da", nor: "no", fin: "fi", gre: "el", ell: "el", hun: "hu", cze: "cs", ces: "cs",
  rum: "ro", ron: "ro", ukr: "uk", vie: "vi", tha: "th", ind: "id", hin: "hi", per: "fa", fas: "fa", bul: "bg",
  hrv: "hr", srp: "sr", slv: "sl", slo: "sk", slk: "sk", may: "ms", msa: "ms",
};

/** Languages offered as preferences, in the order people are most likely to look. */
export const PREFERRED_LANGUAGES = [
  "en", "es", "fr", "de", "it", "pt", "pt-BR", "nl", "sv", "da", "no", "fi", "pl", "cs", "sk", "hu", "ro", "bg",
  "hr", "sr", "sl", "el", "tr", "ru", "uk", "ar", "he", "fa", "hi", "th", "vi", "id", "ms", "ja", "ko", "zh",
];

export function languageName(code?: string) {
  if (!code || code === "und") return undefined;
  const norm = ISO3[code.toLowerCase()] ?? code;
  try {
    return names.of(norm) ?? code;
  } catch {
    return code;
  }
}

/** Does a track/addon language code (`eng`, `en`, `pt-BR`) match a preference (`en`)? */
export function langMatches(code: string | undefined, pref: string) {
  if (!code || !pref) return false;
  const norm = (ISO3[code.toLowerCase()] ?? code).toLowerCase();
  const want = pref.toLowerCase();
  return norm === want || norm.split("-")[0] === want.split("-")[0];
}
