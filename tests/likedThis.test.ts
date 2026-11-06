import { describe, expect, test } from "bun:test";
import type { Anime, AnimeCard } from "../src/lib/anime/anilist";
import { likedThis } from "../src/lib/anime/likedThis";
import { readRecommendations } from "../src/lib/anime/responses";

const card = (id: number, english: string, chain: number[] = []): AnimeCard => ({ id, title: { english, romaji: english }, coverImage: {}, chain });
const rec = (c: AnimeCard, rating: number) => ({ rating, mediaRecommendation: c });

/** "Tower of Glass" season 1 (id 1): its sequel 2 is related, 3 follows 2. */
const anime = {
  ...card(1, "Tower of Glass"),
  relations: { edges: [{ relationType: "SEQUEL", node: card(2, "Garasu Arc") }] },
  recommendations: { nodes: [] },
} as unknown as Anime;

describe('"If You Liked This" (#191)', () => {
  test("leaves out the current franchise: related entries, their sequels, season tabs and same-named entries", () => {
    const recs = [
      rec(card(2, "Garasu Arc"), 90),
      rec(card(3, "Final Arc", [2]), 80),
      rec(card(4, "Tower of Glass: Requiem"), 70),
      rec(card(5, "Unnamed Special"), 60),
      rec(card(6, "Elsewind"), 10),
    ];
    const out = likedThis(anime, recs, [card(5, "Unnamed Special")], false);
    expect(out.map((c) => c.id)).toEqual([6]);
  });

  test("one card per franchise, its most recommended entry, ranked by the franchise's ratings together", () => {
    const recs = [
      rec(card(10, "Paleblade"), 50),
      rec(card(20, "Elsewind Season 2", [21]), 40),
      rec(card(21, "Elsewind"), 30),
      rec(card(22, "Elsewind: The Movie"), 20),
      rec(card(11, "Paleblade Part 2"), 5),
    ];
    const out = likedThis(anime, recs, [], false);
    expect(out.map((c) => c.id)).toEqual([20, 10]);
  });

  test("with seasons as separate shows, every recommended entry keeps its card, the current franchise still left out", () => {
    const recs = [rec(card(3, "Final Arc", [2]), 80), rec(card(20, "Elsewind Season 2", [21]), 40), rec(card(21, "Elsewind"), 30)];
    expect(likedThis(anime, recs, [], true).map((c) => c.id)).toEqual([20, 21]);
  });

  test("a second page that repeats an entry counts it once", () => {
    const recs = [rec(card(10, "Paleblade"), 50), rec(card(10, "Paleblade"), 50), rec(card(30, "Kazeori"), 60)];
    expect(likedThis(anime, recs, [], false).map((c) => c.id)).toEqual([30, 10]);
  });

  test("reads ratings, prequel/sequel links and whether more were left", () => {
    const read = readRecommendations({
      pageInfo: { hasNextPage: true },
      nodes: [
        {
          rating: 12,
          mediaRecommendation: {
            id: 7,
            title: { english: "Elsewind" },
            relations: {
              edges: [
                { relationType: "SEQUEL", node: { id: 8 } },
                { relationType: "ADAPTATION", node: { id: 9 } },
              ],
            },
          },
        },
        { rating: 3, mediaRecommendation: null },
      ],
    });
    expect(read.hasNextPage).toBe(true);
    expect(read.nodes.map((n) => [n.rating, n.mediaRecommendation?.id ?? null, n.mediaRecommendation?.chain])).toEqual([
      [12, 7, [8]],
      [3, null, undefined],
    ]);
  });
});
