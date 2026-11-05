import { describe, expect, test } from "bun:test";
import { titlePage, type PageLookup } from "../src/lib/anime/titlePage";
import type { AnimeLink } from "../src/lib/library/identity";
import type { MetaPreview } from "../src/lib/types";

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

function lookup(over: Partial<PageLookup> = {}): PageLookup & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    animeEnabled: true,
    links: async () => [],
    meta: async (type, id) => {
      asked.push(`meta ${id}`);
      return { id, type, name: "Show", genres: ["Animation"], releaseInfo: "2020" };
    },
    anilistForImdb: async (id) => {
      asked.push(`anilist ${id}`);
      return id === "tt1" ? 101 : null;
    },
    anilistForKitsu: async (k) => {
      asked.push(`kitsu ${k}`);
      return k === 7 ? 707 : null;
    },
    storage: memory(),
    now: () => 1_000_000,
    ...over,
  };
}

const link = (canonical: string, anilist: number, updatedAt = 1): AnimeLink => ({ canonical, anilist, updatedAt });
const preview = (genres: string[]): MetaPreview => ({ id: "tt1", type: "series", name: "Show", genres });

describe("one page per title, chosen before anything renders (test report 1, item 1 / 4b)", () => {
  test("an anime reached by its IMDb id opens as the anime page", async () => {
    expect(await titlePage("series", "tt1", undefined, lookup())).toEqual({ kind: "anime", anilist: 101 });
  });

  test("a title that isn't animated never waits for an anime lookup", async () => {
    const l = lookup();
    expect(await titlePage("movie", "tt2", preview(["Drama"]), l)).toEqual({ kind: "title" });
    expect(l.asked).toEqual([]);
  });

  test("a stored anime link answers at once, without the network (Continue Watching after a restart)", async () => {
    const l = lookup({ links: async () => [link("tt9", 50, 2), link("tt9", 40, 3), link("tt8", 30)] });
    expect(await titlePage("series", "tt9", undefined, l)).toEqual({ kind: "anime", anilist: 40 });
    expect(l.asked).toEqual([]);
  });

  test("Kitsu ids open their anime page too", async () => {
    expect(await titlePage("series", "kitsu:7", undefined, lookup())).toEqual({ kind: "anime", anilist: 707 });
    const linked = lookup({ links: async () => [{ ...link("kitsu:5", 55), kitsu: 5 }] });
    expect(await titlePage("series", "kitsu:5", undefined, linked)).toEqual({ kind: "anime", anilist: 55 });
    expect(linked.asked).toEqual([]);
  });

  test("an answer is remembered across starts; a 'not an anime' answer only for a while", async () => {
    const storage = memory();
    const first = lookup({ storage });
    await titlePage("series", "tt1", undefined, first);
    await titlePage("series", "tt3", undefined, first);
    const again = lookup({ storage });
    expect(await titlePage("series", "tt1", undefined, again)).toEqual({ kind: "anime", anilist: 101 });
    expect(await titlePage("series", "tt3", undefined, again)).toEqual({ kind: "title" });
    expect(again.asked).toEqual([]);
    const later = lookup({ storage, now: () => 1_000_000 + 8 * 86_400_000 });
    await titlePage("series", "tt3", undefined, later);
    expect(later.asked).toEqual(["meta tt3", "anilist tt3"]);
  });

  test("a failed lookup opens the title page and isn't remembered", async () => {
    const storage = memory();
    const failing = lookup({
      storage,
      anilistForImdb: async () => {
        throw new Error("offline");
      },
    });
    expect(await titlePage("series", "tt1", undefined, failing)).toEqual({ kind: "title" });
    expect(await titlePage("series", "tt1", undefined, lookup({ storage }))).toEqual({ kind: "anime", anilist: 101 });
  });

  test("with anime off, every title opens as it is", async () => {
    const l = lookup({ animeEnabled: false });
    expect(await titlePage("series", "tt1", undefined, l)).toEqual({ kind: "title" });
    expect(await titlePage("series", "kitsu:7", undefined, l)).toEqual({ kind: "title" });
  });
});
