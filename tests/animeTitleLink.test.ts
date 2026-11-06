import { describe, expect, test } from "bun:test";
import type { Titled, Links, Lookup } from "../src/lib/anime/search";
import type { AniZip } from "../src/lib/anime/anizip";
import type { MetaPreview, SearchResults, Video } from "../src/lib/types";

// The anime modules reach ones that read localStorage when they load.
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const { animeImdb, lookupTitles } = await import("../src/lib/anime/search");

// An invented weekly show from this season that no mapping knows yet: AniList calls it by its romaji
// name, the catalogs by the English name only AniList's synonyms carry (#189).
const DAY = 86_400_000;
const NOW = Date.now();
const premiere = NOW - 15 * DAY - DAY / 2;
const year = new Date(premiere).getUTCFullYear();

const show: Titled = {
  id: 9001,
  format: "TV",
  seasonYear: year,
  title: { romaji: "Hoshikuzu Ryokou-dan", english: null, native: "星屑旅行団" },
  synonyms: ["Stardust Wanderers"],
} as unknown as Titled;

const aired = (n: number) => new Date(premiere + (n - 1) * 7 * DAY).toISOString();
const zipWithEpisodes = (mappings: AniZip["mappings"] = { anilist_id: 9001 }): AniZip => ({
  mappings,
  episodes: Object.fromEntries([1, 2, 3].map((n) => [String(n), { episode: String(n), seasonNumber: 1, episodeNumber: n, airDateUtc: aired(n) }])),
});

const series = (id: string, name: string, releaseInfo = `${year}-`): MetaPreview => ({ id, type: "series", name, releaseInfo }) as MetaPreview;
const dated = (id: string): Video[] => [1, 2, 3].map((n) => ({ id: `${id}:1:${n}`, title: "", season: 1, episode: n, released: aired(n).slice(0, 10) }));

/** A catalog that answers each search from `found`, and each show's episodes from `episodes`. */
function catalog(found: Record<string, MetaPreview[]>, episodes: Record<string, Video[]> = {}, failing: string[] = []) {
  const searched: string[] = [];
  const lookup: Lookup = {
    search: async (q: string): Promise<SearchResults> => {
      searched.push(q);
      if (failing.includes(q) || failing.includes("*")) throw new Error("offline");
      return { movies: [], series: found[q] ?? [] };
    },
    meta: async (_type: string, id: string) => ({ id, type: "series", name: "", videos: episodes[id] ?? [] }) as never,
  };
  return { lookup, searched };
}

const none: Links = { listed: async () => null, stored: async () => undefined };

describe("linking an anime no mapping knows (#189)", () => {
  test("its English name among the synonyms finds the series, which has its aired episodes", async () => {
    const { lookup } = catalog({ "Stardust Wanderers": [series("tt0000901", "Stardust Wanderers")] }, { tt0000901: dated("tt0000901") });
    expect(await animeImdb(show, zipWithEpisodes(), lookup, none)).toEqual({ id: "tt0000901", by: "title" });
  });

  test("a series the catalogs have no dated episodes for yet is linked by name and year", async () => {
    const { lookup } = catalog({ "Stardust Wanderers": [series("tt0000901", "Stardust Wanderers")] });
    expect(await animeImdb(show, zipWithEpisodes(), lookup, none)).toEqual({ id: "tt0000901", by: "title" });
  });

  test("ani.zip not knowing the show at all is the same", async () => {
    const { lookup } = catalog({ "Stardust Wanderers": [series("tt0000901", "Stardust Wanderers")] });
    expect(await animeImdb(show, null, lookup, none)).toEqual({ id: "tt0000901", by: "title" });
  });

  test("a result under any of its titles counts, whichever title was searched", async () => {
    const { lookup } = catalog({ "Hoshikuzu Ryokou-dan": [series("tt0000901", "Stardust Wanderers")] });
    expect(await animeImdb(show, null, lookup, none)).toEqual({ id: "tt0000901", by: "title" });
  });

  test("an older show by that name, with other episodes, isn't it", async () => {
    const { lookup } = catalog(
      { "Stardust Wanderers": [series("tt0000902", "Stardust Wanderers", "1998-1999")] },
      { tt0000902: [{ id: "tt0000902:1:1", title: "", season: 1, episode: 1, released: "1998-04-01" }] },
    );
    expect(await animeImdb(show, zipWithEpisodes(), lookup, none)).toBeNull();
  });

  test("a series of the same name from another year with no episodes isn't it either", async () => {
    const { lookup } = catalog({ "Stardust Wanderers": [series("tt0000902", "Stardust Wanderers", "2003-2004")] });
    expect(await animeImdb(show, zipWithEpisodes(), lookup, none)).toBeNull();
  });

  test("a name that only contains the title isn't a match", async () => {
    const { lookup } = catalog({ "Stardust Wanderers": [series("tt0000903", "Stardust Wanderers: The Musical")] });
    expect(await animeImdb(show, null, lookup, none)).toBeNull();
  });

  test("the id lists' link is used when ani.zip has none", async () => {
    const { lookup, searched } = catalog({});
    const links: Links = { listed: async () => "tt0000904", stored: async () => undefined };
    expect(await animeImdb(show, null, lookup, links)).toEqual({ id: "tt0000904", by: "mapping" });
    expect(searched).toEqual([]);
  });

  test("a stored link (picked by hand) comes before a title search", async () => {
    const { lookup, searched } = catalog({ "Stardust Wanderers": [series("tt0000901", "Stardust Wanderers")] });
    const links: Links = { listed: async () => null, stored: async () => "tt0000905" };
    expect(await animeImdb(show, null, lookup, links)).toEqual({ id: "tt0000905", by: "stored" });
    expect(searched).toEqual([]);
  });

  test("a mapping's link comes before a stored one", async () => {
    const { lookup } = catalog({});
    const links: Links = { listed: async () => null, stored: async () => "tt0000905" };
    expect(await animeImdb(show, { mappings: { anilist_id: 9001, imdb_id: "tt0000906" }, episodes: {} }, lookup, links)).toEqual({ id: "tt0000906", by: "mapping" });
  });

  test("an entry with only a Kitsu id plays by it and isn't searched for", async () => {
    const { lookup, searched } = catalog({ "Stardust Wanderers": [series("tt0000901", "Stardust Wanderers")] });
    expect(await animeImdb(show, { mappings: { anilist_id: 9001, kitsu_id: 77 }, episodes: {} }, lookup, none)).toBeNull();
    expect(searched).toEqual([]);
  });

  test("one failed search doesn't stop the others", async () => {
    const { lookup } = catalog({ "Stardust Wanderers": [series("tt0000901", "Stardust Wanderers")] }, {}, ["Hoshikuzu Ryokou-dan"]);
    expect(await animeImdb(show, null, lookup, none)).toEqual({ id: "tt0000901", by: "title" });
  });

  test("every search failing is an error, not 'no such show'", async () => {
    const { lookup } = catalog({}, {}, ["*"]);
    expect(animeImdb(show, null, lookup, none)).rejects.toThrow("offline");
  });
});

describe("lookupTitles", () => {
  test("its own titles, then without the part name, then the synonyms and the native title, each once", () => {
    const t = lookupTitles({
      title: { romaji: "Hoshikuzu Ryokou-dan 2nd Season", english: "Stardust Wanderers Season 2", native: "星屑旅行団 第2期" },
      synonyms: ["Stardust Wanderers season 2", "SW2"],
    });
    expect(t).toEqual(["Stardust Wanderers Season 2", "Hoshikuzu Ryokou-dan 2nd Season", "Stardust Wanderers", "Hoshikuzu Ryokou-dan", "SW2", "星屑旅行団 第2期"]);
  });
});
