import { describe, expect, test } from "bun:test";
import { readAniZip, readAnime, readCard, readCards, readLinked, readPage, readSkipTimes, readSlot } from "../src/lib/anime/responses";

describe("AniList cards", () => {
  test("a card needs an id; a field of the wrong kind reads as missing", () => {
    expect(readCard({ title: { romaji: "No id" } })).toBeUndefined();
    expect(readCard({ id: "21" })).toBeUndefined();
    const card = readCard({
      id: 21,
      title: { romaji: "Salt Horizon", english: 7 },
      coverImage: null,
      format: "TV",
      status: "SOMETHING_NEW",
      episodes: -3,
      averageScore: 88,
      genres: ["Action", 3, "Adventure"],
      startDate: { year: 1999, month: 10, day: "20" },
      nextAiringEpisode: { episode: 1100, airingAt: 1_730_000_000 },
    })!;
    expect(card.title).toEqual({ romaji: "Salt Horizon", english: null, native: null });
    expect(card.coverImage).toEqual({ extraLarge: null, large: null, color: null });
    expect(card.format).toBe("TV");
    expect(card.status).toBeNull();
    expect(card.episodes).toBeNull();
    expect(card.genres).toEqual(["Action", "Adventure"]);
    expect(card.startDate).toEqual({ year: 1999, month: 10, day: null });
    expect(card.nextAiringEpisode).toEqual({ episode: 1100, airingAt: 1_730_000_000, timeUntilAiring: 0 });
    expect("description" in card).toBe(false);
    expect(readCard({ id: 1, description: null })!.description).toBeNull();
  });

  test("a list keeps the cards that read", () => {
    expect(readCards([{ id: 1 }, null, { id: 0 }, "x", { id: 2 }]).map((c) => c.id)).toEqual([1, 2]);
    expect(readCards({ id: 1 })).toEqual([]);
  });

  test("pages: the list under its field and whether there's more", () => {
    expect(readPage({ Page: { pageInfo: { hasNextPage: true }, media: [1] } }, "media")).toEqual({ hasNextPage: true, items: [1] });
    expect(readPage({ Page: null }, "media")).toEqual({ hasNextPage: false, items: undefined });
    expect(readPage({ Page: { pageInfo: { hasNextPage: "yes" } } }, "media").hasNextPage).toBe(false);
  });

  test("relations of kinds the app doesn't know are left out", () => {
    const linked = readLinked({
      id: 5,
      relations: {
        edges: [
          { relationType: "SEQUEL", node: { id: 6, type: "ANIME", format: "TV" } },
          { relationType: "REMAKE", node: { id: 7 } },
          { relationType: "PREQUEL", node: {} },
        ],
      },
    })!;
    expect(linked.relations.edges).toEqual([{ relationType: "SEQUEL", node: { id: 6, type: "ANIME", format: "TV" } }]);
    expect(readLinked({ id: 5 })!.relations.edges).toEqual([]);
  });

  test("airing slots need an id, an episode, a time and a show", () => {
    const slot = { id: 9, episode: 3, airingAt: 100, media: { id: 1, isAdult: false, countryOfOrigin: "JP", popularity: 900 } };
    expect(readSlot(slot)!.media).toMatchObject({ id: 1, isAdult: false, countryOfOrigin: "JP", popularity: 900 });
    expect(readSlot({ ...slot, media: null })).toBeUndefined();
    expect(readSlot({ ...slot, airingAt: "100" })).toBeUndefined();
  });
});

describe("an anime's page", () => {
  test("missing connections read as empty; voices split by language; MAIN first", () => {
    const anime = readAnime({
      id: 1,
      characters: {
        edges: [
          { role: "SUPPORTING", node: { id: 2, name: { full: "B" } }, voiceActors: [] },
          {
            role: "MAIN",
            node: { id: 1, name: { full: "A" }, image: { large: "a.jpg" } },
            voiceActors: [
              { id: 10, name: { full: "Ja" }, languageV2: "Japanese" },
              { id: 11, name: { full: "En" }, languageV2: "English" },
              { id: 12, name: {}, languageV2: "Japanese" },
            ],
          },
          { role: "MAIN", node: { id: 3 } },
        ],
      },
      tags: [{ name: "Isekai", rank: 90, isMediaSpoiler: true }, { rank: 1 }],
      relations: {
        edges: [
          { relationType: "SEQUEL", node: { id: 4 } },
          { relationType: "SEQUEL", node: null },
        ],
      },
      recommendations: { nodes: [{ mediaRecommendation: null }, { mediaRecommendation: { id: 8 } }, 5] },
      trailer: { id: "abc" },
    })!;
    expect(anime.studios.edges).toEqual([]);
    expect(anime.staff.edges).toEqual([]);
    expect(anime.externalLinks).toEqual([]);
    expect(anime.airingSchedule.nodes).toEqual([]);
    expect(anime.trailer).toBeNull();
    expect(anime.characters.edges.map((e) => e.node.name.full)).toEqual(["A", "B"]);
    expect(anime.characters.edges[0].ja.map((p) => p.name.full)).toEqual(["Ja"]);
    expect(anime.characters.edges[0].en.map((p) => p.name.full)).toEqual(["En"]);
    expect(anime.characters.edges[0]).not.toHaveProperty("voiceActors");
    expect(anime.tags).toEqual([{ name: "Isekai", rank: 90, description: null, isMediaSpoiler: true, isGeneralSpoiler: false, category: null }]);
    expect(anime.relations.edges.map((e) => e.node.id)).toEqual([4]);
    expect(anime.recommendations.nodes.map((n) => n.mediaRecommendation?.id ?? null)).toEqual([null, 8]);
  });

  test("no record, no page", () => {
    expect(readAnime(null)).toBeUndefined();
    expect(readAnime({ title: {} })).toBeUndefined();
  });
});

describe("ani.zip", () => {
  test("no mappings means it doesn't know the show", () => {
    expect(readAniZip(null)).toBeNull();
    expect(readAniZip({ episodes: {} })).toBeNull();
    expect(readAniZip({ mappings: "x" })).toBeNull();
  });

  test("ids, images and episodes that fit are kept", () => {
    const z = readAniZip({
      titles: { en: "Elsewind", ja: 3 },
      mappings: { anilist_id: 154587, mal_id: "52991", imdb_id: "tt0000112", themoviedb_id: 209867, thetvdb_id: null },
      images: [{ coverType: "Fanart", url: "f.jpg" }, { coverType: "Thumb", url: "t.jpg" }, { coverType: "Poster" }],
      episodes: {
        "1": { episode: "1", seasonNumber: 1, episodeNumber: 1, title: { en: "The Journey's End", ja: null }, airDateUtc: "2023-09-29T14:00:00Z", rating: 8.4 },
        "2": "broken",
        S1: { seasonNumber: 0 },
      },
    })!;
    expect(z.titles).toEqual({ en: "Elsewind" });
    expect(z.mappings).toEqual({
      anilist_id: 154587,
      mal_id: undefined,
      kitsu_id: undefined,
      imdb_id: "tt0000112",
      themoviedb_id: 209867,
      thetvdb_id: null,
      anidb_id: null,
      type: undefined,
    });
    expect(z.images).toEqual([{ coverType: "Fanart", url: "f.jpg" }]);
    expect(Object.keys(z.episodes)).toEqual(["1", "S1"]);
    expect(z.episodes["1"].title).toEqual({ en: "The Journey's End" });
    expect(z.episodes["1"].rating).toBe("8.4");
    expect(z.episodes.S1.episode).toBe("S1");
  });

  test("episodes that aren't a map of objects read as none", () => {
    expect(readAniZip({ mappings: {}, episodes: [{ episode: "1" }] })!.episodes).toEqual({});
    expect(readAniZip({ mappings: {}, episodes: { "1": 1 } })!.episodes).toEqual({});
  });
});

describe("AniSkip", () => {
  test("only found answers, and spans that end after they start", () => {
    expect(readSkipTimes({ found: false, results: [{ skipType: "op", interval: { startTime: 0, endTime: 90 } }] })).toEqual([]);
    expect(
      readSkipTimes({
        found: true,
        results: [
          { skipType: "op", interval: { startTime: 90, endTime: 10 } },
          { skipType: "op", interval: { startTime: 5, endTime: 95 } },
          { skipType: "ed", interval: null },
          null,
        ],
      }),
    ).toEqual([{ kind: "op", span: { start: 5, end: 95 } }]);
  });
});
