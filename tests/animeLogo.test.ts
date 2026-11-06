import { expect, test } from "bun:test";

const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const { franchiseArt } = await import("../src/lib/anime/anizip");
const { heroSubtitle } = await import("../src/lib/anime/format");

const zip = { background: "https://art.example/series/1/fanart.jpg", logo: "https://art.example/series/1/icons/logo.png" };
const general = { background: "https://art.example/background/large/tt0000001/img", logo: "https://art.example/logo/medium/tt0000001/img" };

test("every season of a franchise shows its linked general title's background and logo (#27)", () => {
  expect(franchiseArt({ imdb: "tt0000001", meta: general, metaLoading: false, first: zip })).toEqual(general);
  // A later season's own ani.zip art never comes in: `first` is always the first entry's.
  expect(franchiseArt({ imdb: "tt0000001", meta: general, metaLoading: false, first: {} })).toEqual(general);
});

test("while the link or the general title loads, no art and no logo, so a logo in another script never flashes", () => {
  expect(franchiseArt({ imdb: undefined, meta: undefined, metaLoading: false, first: zip })).toEqual({ background: undefined, logo: undefined });
  expect(franchiseArt({ imdb: "tt0000001", meta: undefined, metaLoading: true, first: zip })).toEqual({ background: undefined, logo: undefined });
});

test("the first entry's ani.zip art where the general title has none, or there's no general title", () => {
  expect(franchiseArt({ imdb: "tt0000001", meta: { background: general.background }, metaLoading: false, first: zip })).toEqual({ background: general.background, logo: zip.logo });
  expect(franchiseArt({ imdb: "tt0000001", meta: undefined, metaLoading: false, first: zip })).toEqual(zip);
  expect(franchiseArt({ imdb: "kitsu:1", meta: general, metaLoading: false, first: zip })).toEqual(zip);
  expect(franchiseArt({ imdb: null, meta: undefined, metaLoading: false, first: zip })).toEqual(zip);
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
