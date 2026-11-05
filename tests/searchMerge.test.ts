import { describe, expect, test } from "bun:test";
import type { AnimeCard } from "../src/lib/anime/anilist";
import { withoutAnime } from "../src/lib/anime/merge";
import { franchiseName, oneFranchiseEach } from "../src/lib/anime/franchise";
import { aliasTable, type AnimeLink } from "../src/lib/library/identity";
import type { MetaPreview } from "../src/lib/types";

const card = (id: number, english: string, year: number, romaji = english): AnimeCard => ({
  id,
  title: { english, romaji },
  coverImage: {},
  seasonYear: year,
});
const meta = (id: string, name: string, year: number) => ({ id, type: "series", name, releaseInfo: String(year) }) as MetaPreview;
const link = (l: Omit<AnimeLink, "updatedAt">): AnimeLink => ({ updatedAt: 1, ...l });

describe("search merges anime with movies and series", () => {
  test("a linked anime hides its show by id, whatever the titles", () => {
    const aliases = aliasTable([link({ canonical: "tt0000108", anilist: 16498 })]);
    const items = [meta("tt0000108", "Tower of Glass", 2013), meta("tt9", "Other", 2013)];
    const out = withoutAnime(items, [card(16498, "", 2013, "Garasu no Tou")], aliases)!;
    expect(out.map((m) => m.id)).toEqual(["tt9"]);
  });

  test("a linked anime keeps another show with its title (two IMDb ids are never one show)", () => {
    const aliases = aliasTable([link({ canonical: "tt0000111", anilist: 41467 })]);
    const items = [meta("tt0000111", "Paleblade: Hundred-Night Ash War", 2022), meta("tt0000103", "Paleblade", 2004)];
    const out = withoutAnime(items, [card(41467, "Paleblade", 2022)], aliases)!;
    expect(out.map((m) => m.id)).toEqual(["tt0000103"]);
  });

  test("without a link, title and year decide", () => {
    const items = [meta("tt1", "Elsewind", 2023), meta("tt2", "Elsewind", 2001), meta("tt3", "Else", 2023)];
    expect(withoutAnime(items, [card(1, "Elsewind", 2023)])!.map((m) => m.id)).toEqual(["tt2", "tt3"]);
  });

  test("a Kitsu result and its IMDb show come up once", () => {
    const aliases = aliasTable([link({ canonical: "tt100", anilist: 5, kitsu: 7 })]);
    const items = [meta("tt100", "Show", 2020), meta("kitsu:7", "Show", 2020), meta("kitsu:8", "Kitsu only", 2020)];
    expect(withoutAnime(items, [], aliases)!.map((m) => m.id)).toEqual(["tt100", "kitsu:8"]);
    expect(withoutAnime(items, [card(5, "Show", 2020)], aliases)!.map((m) => m.id)).toEqual(["kitsu:8"]);
  });

  test("nothing in, nothing out", () => {
    expect(withoutAnime(undefined, [card(1, "A", 2000)])).toBeUndefined();
  });
});

describe("one card per franchise in every anime list (test report 1, items 10 and 11)", () => {
  test("titles naming the same franchise are one, even with no link between them in the list", () => {
    const list = [card(1, "Ginbou: THE LAST CURTAIN", 2021), card(2, "Ginbou Season 3", 2015, "Ginbou."), card(3, "Elsewind", 2023), card(4, "Ginbou°", 2015)];
    expect(oneFranchiseEach(list).map((a) => a.id)).toEqual([1, 3]);
  });

  test("prequel and sequel links join entries whatever they're called", () => {
    const list = [{ ...card(1, "Kazeori", 2002), chain: [2] }, card(2, "Arashi-hen", 2007), card(3, "Paleblade", 2004)];
    expect(oneFranchiseEach(list).map((a) => a.id)).toEqual([1, 3]);
  });

  test("franchise names", () => {
    expect(franchiseName("Tower of Glass: The Final Season")).toBe("towerofglass");
    expect(franchiseName("Tower of Glass Season 3 Part 2")).toBe("towerofglass");
    expect(franchiseName("Re:START -Another Morning-")).toBe("restart");
    expect(franchiseName("Mr. PEBBLE")).toBe("mrpebble");
    expect(franchiseName("Sky Lantern Z")).not.toBe(franchiseName("Sky Lantern Super"));
  });

  test("a later part Cinemeta lists as its own show is hidden by the full list, not the collapsed one", () => {
    const anime = [card(1, "Kiko's Curious Journey", 2012), card(9, "Kiko's Curious Journey: Iron Wheel Race", 2026)];
    const sbr: MetaPreview = { id: "tt0000114", type: "series", name: "Kiko's Curious Journey: Iron Wheel Race", releaseInfo: "2026–" };
    expect(withoutAnime([sbr], oneFranchiseEach(anime))).toEqual([sbr]);
    expect(withoutAnime([sbr], anime)).toEqual([]);
  });
});
