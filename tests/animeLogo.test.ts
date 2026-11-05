import { expect, test } from "bun:test";

const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const { heroLogo } = await import("../src/lib/anime/anizip");

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
