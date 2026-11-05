import { expect, test } from "bun:test";

const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const { heroLogo } = await import("../src/lib/anime/anizip");
const { heroSubtitle } = await import("../src/lib/anime/format");

const zipLogo = "https://art.example/series/1/icons/logo.png";
const imdbLogo = "https://art.example/logo/medium/tt0000001/img";

test("a franchise's first entry shows the linked IMDb title's logo, not ani.zip's language-less one (re-test N1)", () => {
  expect(heroLogo({ aniZipLogo: zipLogo, metaId: "tt0000001", meta: { logo: imdbLogo }, metaLoading: false })).toEqual({ logo: imdbLogo, readable: true });
});

test("while the IMDb title loads, the name shows, so a logo in another script never flashes", () => {
  expect(heroLogo({ aniZipLogo: zipLogo, metaId: "tt0000001", meta: undefined, metaLoading: true })).toEqual({ logo: undefined, readable: true });
});

test("ani.zip's logo only when there's no other; it may be in any script, so the name goes under it", () => {
  expect(heroLogo({ aniZipLogo: zipLogo, metaId: "tt0000001", meta: { logo: undefined }, metaLoading: false })).toEqual({ logo: zipLogo, readable: false });
  expect(heroLogo({ aniZipLogo: zipLogo, metaId: "kitsu:1", meta: { logo: "https://art.example/k.png" }, metaLoading: false })).toEqual({ logo: zipLogo, readable: false });
  expect(heroLogo({ aniZipLogo: zipLogo, metaId: undefined, meta: undefined, metaLoading: false })).toEqual({ logo: zipLogo, readable: false });
});

test("later entries keep their title as text", () => {
  expect(heroLogo({ aniZipLogo: undefined, metaId: "tt0000001", meta: { logo: imdbLogo }, metaLoading: false })).toEqual({ logo: undefined, readable: true });
});

const glass = { english: "Tower of Glass", romaji: "Garasu no Tou", native: "ガラスの塔" };

test("under an English logo, the English title, not only the native one (#35)", () => {
  expect(heroSubtitle(glass, "english", true)).toBe("Tower of Glass");
  expect(heroSubtitle({ ...glass, english: null }, "english", true)).toBe("Garasu no Tou");
  expect(heroSubtitle(glass, "romaji", true)).toBe("Garasu no Tou");
  expect(heroSubtitle(glass, "native", true)).toBe("ガラスの塔");
});

test("under a text heading, the title in the other script, never the heading again", () => {
  expect(heroSubtitle(glass, "english", false)).toBe("ガラスの塔");
  expect(heroSubtitle(glass, "native", false)).toBe("Garasu no Tou");
  expect(heroSubtitle({ english: "Same", native: "Same" }, "english", false)).toBeUndefined();
  expect(heroSubtitle({ romaji: "Garasu no Tou" }, "english", false)).toBeUndefined();
});
