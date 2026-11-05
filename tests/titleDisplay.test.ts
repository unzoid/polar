import { describe, expect, test } from "bun:test";
import { builtPictures, fillUntitled, type DisplayDeps } from "../src/lib/account/titleDisplay";
import type { TitleDisplay, TitleRef } from "../src/lib/types";

describe("names and pictures for pulled titles", () => {
  test("pictures built from ids where the source has a pattern", () => {
    expect(builtPictures("tt0000105")).toEqual({
      poster: "https://images.metahub.space/poster/medium/tt0000105/img",
      background: "https://images.metahub.space/background/large/tt0000105/img",
    });
    expect(builtPictures("kitsu:7442")).toEqual({ poster: "https://media.kitsu.app/anime/poster_images/7442/medium.jpg" });
    expect(builtPictures("tmdb:603")).toEqual({});
    expect(builtPictures("tt1/../x")).toEqual({});
  });

  test("looks each title up once, fills what it found, remembers what failed", async () => {
    const untitled: TitleRef[] = ["tt1", "kitsu:2", "gone", "tt4", "tt5"].map((id) => ({ id, type: "series" }));
    const filled: TitleDisplay[][] = [];
    const asked: string[] = [];
    const deps: DisplayDeps = {
      untitled: async () => untitled,
      fill: async (_space, found) => (filled.push(found), true),
      meta: async (_type, id) => {
        asked.push(id);
        if (id === "gone") throw new Error("404");
        return id === "kitsu:2" ? { name: "Two", background: "bg" } : { name: `Name ${id}`, poster: `p-${id}` };
      },
    };
    const failed = new Set<string>();
    let refreshed = 0;
    expect(
      await fillUntitled(
        "s",
        deps,
        failed,
        () => true,
        () => refreshed++,
      ),
    ).toBe(true);
    expect(filled.map((b) => b.length)).toEqual([3, 1]);
    expect(filled[0][1]).toEqual({ id: "kitsu:2", name: "Two", poster: "https://media.kitsu.app/anime/poster_images/2/medium.jpg", background: "bg" });
    expect(filled[0][0]).toEqual({ id: "tt1", name: "Name tt1", poster: "p-tt1", background: "https://images.metahub.space/background/large/tt1/img" });
    expect([...failed]).toEqual(["gone"]);
    expect(refreshed).toBe(2);

    asked.length = 0;
    await fillUntitled("s", deps, failed, () => true);
    expect(asked.includes("gone")).toBe(false);
  });

  test("stops when the profile is no longer active", async () => {
    let calls = 0;
    const deps: DisplayDeps = {
      untitled: async () => Array.from({ length: 12 }, (_, i) => ({ id: `tt${i + 1}`, type: "movie" as const })),
      fill: async () => true,
      meta: async () => (calls++, { name: "x" }),
    };
    await fillUntitled("s", deps, new Set(), () => calls < 4);
    expect(calls).toBe(4);
  });
});
