import { describe, expect, test } from "bun:test";
import type { AnimeCard } from "../src/lib/anime/anilist";
import { withoutAnime } from "../src/lib/anime/merge";
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
