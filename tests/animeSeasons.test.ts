import { describe, expect, test } from "bun:test";
import type { ChainLink, MediaFormat } from "../src/lib/anime/anilist";
import { isSeason, walkSeasons } from "../src/lib/anime/seasons";

function entry(id: number, format: MediaFormat, episodes: number | null, prequel?: number, sequel?: number, prequelFormat?: MediaFormat): ChainLink {
  const edges: ChainLink["relations"]["edges"] = [];
  if (prequel) edges.push({ relationType: "PREQUEL", node: { id: prequel, type: "ANIME", format: prequelFormat ?? "TV" } });
  if (sequel) edges.push({ relationType: "SEQUEL", node: { id: sequel, type: "ANIME", format: "TV" } });
  return { id, format, episodes, title: { romaji: `e${id}`, english: null, native: null }, relations: { edges } } as unknown as ChainLink;
}

describe("season walk (test report 1, items 8 and 12)", () => {
  test("a one-episode ONA set before the show isn't its Season 1 (Salt Horizon and LANTERNS)", async () => {
    const all = new Map([[167404, entry(167404, "ONA", 1, undefined, 21)]]);
    const onePiece = entry(21, "TV", null, 167404, undefined, "ONA");
    const walk = await walkSeasons(onePiece, async (id) => all.get(id)!);
    expect(walk.seasons.map((s) => [s.card.id, s.label])).toEqual([[21, "Season 1"]]);
    expect(walk.complete).toBe(true);
  });

  test("web series and shorts with a real run are seasons; OVAs never are", () => {
    expect(isSeason({ format: "ONA", episodes: 12 })).toBe(true);
    expect(isSeason({ format: "ONA", episodes: null })).toBe(true);
    expect(isSeason({ format: "TV_SHORT", episodes: 2 })).toBe(false);
    expect(isSeason({ format: "OVA", episodes: 12 })).toBe(false);
    expect(isSeason({ format: "MOVIE", episodes: 1 })).toBe(true);
  });

  test("a step that fails keeps what was found and says the list isn't complete", async () => {
    const all = new Map([[2, entry(2, "TV", 12, 1, 3)]]);
    const first = entry(1, "TV", 12, undefined, 2);
    const walk = await walkSeasons(first, async (id) => {
      const e = all.get(id);
      if (!e) throw new Error("429");
      return e;
    });
    expect(walk.seasons.map((s) => s.label)).toEqual(["Season 1", "Season 2"]);
    expect(walk.complete).toBe(false);
  });

  test("neighbours that came with the answer cost no request", async () => {
    const second = entry(2, "TV", 12, 1);
    const first = entry(1, "TV", 12, undefined, 2);
    first.relations.edges[0].node.full = second;
    let asked = 0;
    const walk = await walkSeasons(first, async () => {
      asked++;
      throw new Error("not needed");
    });
    expect(walk.seasons.map((s) => s.card.id)).toEqual([1, 2]);
    expect(asked).toBe(0);
  });
});
