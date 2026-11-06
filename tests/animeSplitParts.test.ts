import { describe, expect, test } from "bun:test";
import type { Anime, ChainLink } from "../src/lib/anime/anilist";
import type { AniZip } from "../src/lib/anime/anizip";
import { animeEpisodes } from "../src/lib/anime/episodes";
import { walkSeasons } from "../src/lib/anime/seasons";
import { entryZip, prequelOf, sameSplitEntry } from "../src/lib/anime/splitParts";
import type { Links, Lookup } from "../src/lib/anime/search";
import type { MetaPreview, SearchResults, Video } from "../src/lib/types";

// The anime modules reach ones that read localStorage when they load.
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const { animeImdb, withoutPart } = await import("../src/lib/anime/search");

// An invented franchise: two TV seasons, then a newest part split into "1st Leg" (one long episode,
// in March) and "2nd & 3rd Leg" (weekly from September). ani.zip lists the whole part under the first
// entry, numbered across both (1 in March, 2 onwards in September), and knows nothing of the second.
const NOW = Date.parse("2026-11-06T12:00:00Z");
const WEEK = 7 * 86_400_000;
const FIRST = Date.parse("2026-03-19T07:00:00Z");
const SECOND = Date.parse("2026-09-25T07:00:00Z");
const at = (i: number) => SECOND + i * WEEK;

function entry(id: number, title: string, format: "TV" | "ONA", episodes: number | null, prequel?: number, sequel?: number): ChainLink {
  const edges: ChainLink["relations"]["edges"] = [];
  if (prequel) edges.push({ relationType: "PREQUEL", node: { id: prequel, type: "ANIME", format: "TV" } });
  if (sequel) edges.push({ relationType: "SEQUEL", node: { id: sequel, type: "ANIME", format: "ONA" } });
  return { id, format, episodes, title: { romaji: title, english: null, native: null }, relations: { edges } } as unknown as ChainLink;
}

const s1 = entry(1, "Kestrel Hollow", "TV", 12, undefined, 2);
const s2 = entry(2, "Kestrel Hollow: Iron Trail", "TV", 12, 1, 3);
const leg1 = entry(3, "Kestrel Hollow: Iron Trail - 1st Leg", "ONA", 1, 2, 4);
const leg2 = entry(4, "Kestrel Hollow: Iron Trail - 2nd & 3rd Leg", "ONA", 11, 3);

const leg1Zip: AniZip = {
  mappings: { anilist_id: 3, imdb_id: "tt0000001", kitsu_id: 30, mal_id: 300, thetvdb_id: 10 },
  episodes: Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => {
      const n = i + 1;
      const aired = new Date(n === 1 ? FIRST : at(n - 2)).toISOString();
      return [String(n), { episode: String(n), seasonNumber: 3, episodeNumber: n, airDateUtc: aired, title: { en: `Trail ${n}` } }];
    }),
  ),
};
const leg2Zip: AniZip = { mappings: { anilist_id: 4, type: "ONA" }, episodes: {} };

// The IMDb show keeps the part as one season: the long first episode, then the weekly ones.
const videos: Video[] = Array.from({ length: 12 }, (_, i) => ({
  id: `tt0000001:3:${i + 1}`,
  title: "",
  season: 3,
  episode: i + 1,
  released: new Date(i === 0 ? FIRST : at(i - 1)).toISOString().slice(0, 10),
}));

const page = (card: ChainLink, over: Partial<Anime>): Anime =>
  ({ ...card, relations: { edges: card.relations.edges.map((e) => ({ ...e, node: { ...e.node, title: {} } })) }, ...over }) as unknown as Anime;
const leg1Page = page(leg1, {
  status: "FINISHED",
  startDate: { year: 2026, month: 3, day: 19 },
  endDate: { year: 2026, month: 3, day: 19 },
  airingSchedule: { nodes: [] },
});
const leg2Page = page(leg2, {
  status: "RELEASING",
  startDate: { year: 2026, month: 9, day: 25 },
  airingSchedule: { nodes: Array.from({ length: 11 }, (_, i) => ({ episode: i + 1, airingAt: Math.floor((at(i) + 9 * 3_600_000) / 1000) })) },
});

describe("a franchise's newest part split into two entries", () => {
  test("the short first part is a season of its own, in order", async () => {
    const all = new Map([s1, s2, leg1, leg2].map((e) => [e.id, e]));
    const walk = await walkSeasons(s2, async (id) => all.get(id)!);
    expect(walk.seasons.map((s) => [s.card.id, s.label])).toEqual([
      [1, "Season 1"],
      [2, "Season 2"],
      [3, "Season 3"],
      [4, "Season 4"],
    ]);
  });

  test("only parts that share a title once the part name is gone are one split entry", () => {
    expect(sameSplitEntry(leg1, leg2)).toBe(true);
    expect(sameSplitEntry(s2, leg1)).toBe(false);
    expect(sameSplitEntry(entry(9, "Kestrel Hollow - Lanterns", "ONA", 1), s1)).toBe(false);
  });

  test("the first part lists its own episode, not the next part's", () => {
    const zip = entryZip(leg1Page, leg1Zip);
    const eps = animeEpisodes({ anime: leg1Page, zip, videos, imdb: "tt0000001", titles: "english", now: NOW });
    expect(eps.map((e) => [e.number, e.video?.id, e.title])).toEqual([[1, "tt0000001:3:1", "Trail 1"]]);
  });

  test("the second part lists every episode from 1, aired and upcoming, from the first part's record", () => {
    expect(prequelOf(leg2Page)).toBe(3);
    const zip = entryZip(leg2Page, leg2Zip, leg1Zip);
    expect(zip?.mappings).toEqual({ anilist_id: 4, imdb_id: "tt0000001", themoviedb_id: undefined, thetvdb_id: 10, type: undefined });
    const eps = animeEpisodes({ anime: leg2Page, zip, videos, imdb: zip?.mappings.imdb_id ?? undefined, titles: "english", now: NOW });
    expect(eps.map((e) => e.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(eps.slice(0, 7).map((e) => [e.number, e.video?.id, e.upcoming, e.title])).toEqual([
      [1, "tt0000001:3:2", false, "Trail 2"],
      [2, "tt0000001:3:3", false, "Trail 3"],
      [3, "tt0000001:3:4", false, "Trail 4"],
      [4, "tt0000001:3:5", false, "Trail 5"],
      [5, "tt0000001:3:6", false, "Trail 6"],
      [6, "tt0000001:3:7", false, "Trail 7"],
      [7, "tt0000001:3:8", true, "Trail 8"],
    ]);
  });

  test("an unknown entry whose prequel's record ends with the prequel keeps its own", () => {
    const own = { ...leg1Zip, episodes: { "1": leg1Zip.episodes["1"] } };
    expect(entryZip(leg2Page, leg2Zip, own)).toBe(leg2Zip);
    expect(entryZip(leg2Page, undefined, leg1Zip)).toBeUndefined();
  });
});

// IMDb (and so the catalogs) also list the newest part as a series of its own, "Iron Trail: Kestrel Hollow":
// the first leg is its episode 1, the later legs go on from episode 2 (#78). Its dates are whole days, one a
// day early, as the catalogs write them.
const PART = "tt0000002";
const partVideos: Video[] = Array.from({ length: 12 }, (_, i) => ({
  id: `${PART}:1:${i + 1}`,
  title: "",
  season: 1,
  episode: i + 1,
  released: `${new Date((i === 0 ? FIRST : at(i - 1)) - (i === 4 ? 86_400_000 : 0)).toISOString().slice(0, 10)}T00:00:00.000Z`,
}));
const mainVideos = (withPart: boolean): Video[] => [
  ...[1, 2].flatMap((season) =>
    Array.from({ length: 12 }, (_, i) => ({
      id: `tt0000001:${season}:${i + 1}`,
      title: "",
      season,
      episode: i + 1,
      released: `${2018 + season}-04-0${(i % 9) + 1}`,
    })),
  ),
  ...(withPart ? videos : []),
];

const partFound = { "IRON TRAIL Kestrel Hollow": [{ id: PART, type: "series", name: "Iron Trail: Kestrel Hollow", releaseInfo: "2026-" } as MetaPreview] };

function catalog(main: Video[], found: Record<string, MetaPreview[]> = partFound, partEpisodes = partVideos) {
  const searched: string[] = [];
  const lookup: Lookup = {
    search: async (q: string): Promise<SearchResults> => {
      searched.push(q);
      return { movies: [], series: found[q] ?? [] };
    },
    meta: async (_type: string, id: string) =>
      ({ id, type: "series", name: id === PART ? "Iron Trail: Kestrel Hollow" : "Kestrel Hollow", videos: id === PART ? partEpisodes : main }) as never,
  };
  return { lookup, searched };
}
const noLinks: Links = { listed: async () => null, stored: async () => undefined };
const english = (t: string) => ({ title: { romaji: null, english: t, native: null } });
const leg1Named = { ...leg1Page, ...english("IRON TRAIL Kestrel Hollow 1st Leg") };
const leg2Named = { ...leg2Page, ...english("IRON TRAIL Kestrel Hollow 2nd - 3rd Leg") };

describe("a split part IMDb lists as a series of its own (#78)", () => {
  test("the second part plays from that series when the main show doesn't have its episodes", async () => {
    const zip = entryZip(leg2Named, leg2Zip, leg1Zip);
    const { lookup } = catalog(mainVideos(false));
    expect(await animeImdb(leg2Named, zip ?? null, lookup, noLinks)).toEqual({ id: PART, by: "mapping" });
  });

  test("and when the main show lists them as a season too", async () => {
    const zip = entryZip(leg2Named, leg2Zip, leg1Zip);
    const { lookup, searched } = catalog(mainVideos(true));
    expect(await animeImdb(leg2Named, zip ?? null, lookup, noLinks)).toEqual({ id: PART, by: "mapping" });
    // Only by its name without the part name: the main show's is left out.
    expect(searched).toEqual(["IRON TRAIL Kestrel Hollow"]);
  });

  test("its aired and upcoming episodes line up with the series by air date, from the series' episode 2", () => {
    const zip = entryZip(leg2Named, leg2Zip, leg1Zip);
    const eps = animeEpisodes({ anime: leg2Named, zip, videos: partVideos, imdb: PART, titles: "english", now: NOW });
    expect(eps.map((e) => [e.number, e.video?.id, e.upcoming])).toEqual([
      ...Array.from({ length: 6 }, (_, i) => [i + 1, `${PART}:1:${i + 2}`, false]),
      ...Array.from({ length: 5 }, (_, i) => [i + 7, `${PART}:1:${i + 8}`, true]),
    ]);
  });

  test("the first part is the series' episode 1", async () => {
    const zip = entryZip(leg1Named, leg1Zip);
    const { lookup } = catalog(mainVideos(true));
    expect(await animeImdb(leg1Named, zip ?? null, lookup, noLinks)).toEqual({ id: PART, by: "mapping" });
    const eps = animeEpisodes({ anime: leg1Named, zip, videos: partVideos, imdb: PART, titles: "english", now: NOW });
    expect(eps.map((e) => [e.number, e.video?.id])).toEqual([[1, `${PART}:1:1`]]);
  });

  test("a series by that name without the part's episodes isn't it: the main show stays", async () => {
    const zip = entryZip(leg2Named, leg2Zip, leg1Zip);
    const other = partVideos.map((v) => ({ ...v, released: v.released?.replace("2026", "2011") }));
    expect(await animeImdb(leg2Named, zip ?? null, catalog(mainVideos(true), undefined, other).lookup, noLinks)).toEqual({ id: "tt0000001", by: "mapping" });
    expect(await animeImdb(leg2Named, zip ?? null, catalog(mainVideos(true), undefined, []).lookup, noLinks)).toEqual({ id: "tt0000001", by: "mapping" });
  });

  test("a later season without a part name isn't searched for", async () => {
    const zip = entryZip(leg2Named, leg2Zip, leg1Zip);
    const { lookup, searched } = catalog(mainVideos(true));
    expect(await animeImdb({ ...leg2Named, ...english("Iron Trail") }, zip ?? null, lookup, noLinks)).toEqual({ id: "tt0000001", by: "mapping" });
    expect(searched).toEqual([]);
  });

  test("withoutPart takes off a part name however it's written", () => {
    expect(withoutPart("IRON TRAIL Kestrel Hollow 2nd - 3rd Leg")).toBe("IRON TRAIL Kestrel Hollow");
    expect(withoutPart("IRON TRAIL Kestrel Hollow 1st Stage")).toBe("IRON TRAIL Kestrel Hollow");
    expect(withoutPart("Kestrel Hollow: Iron Trail - 2nd & 3rd Leg")).toBe("Kestrel Hollow: Iron Trail");
    expect(withoutPart("Kestrel Hollow: Iron Trail - The Parting")).toBe("Kestrel Hollow: Iron Trail");
    expect(withoutPart("Kestrel Hollow 2nd Season")).toBe("Kestrel Hollow");
    expect(withoutPart("Kestrel Hollow Part 2")).toBe("Kestrel Hollow");
    expect(withoutPart("Ryokou-dan")).toBe("Ryokou-dan");
  });
});
