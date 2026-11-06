import { expect, test } from "bun:test";

const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const { GENRES, shelfRoute } = await import("../src/lib/catalog/shelves");
const { BROWSE_GENRES } = await import("../src/lib/catalog/genres");

test("a shelf's heading opens Movies or Series at its catalog and genre; Because you watched has none (#48)", () => {
  expect(shelfRoute({ kind: "catalog", type: "movie", id: "new", title: "New Movies", shape: "poster" })).toEqual({
    name: "discover",
    type: "movie",
    catalog: "new",
    genre: undefined,
  });
  expect(shelfRoute({ kind: "catalog", type: "movie", id: "popular", genre: "Animation", title: "Animated Movies", shape: "landscape" })).toMatchObject({
    catalog: "popular",
    genre: "Animation",
  });
  expect(shelfRoute({ kind: "because", type: "series", seed: "tt0000001", title: "Because you watched Kiko", shape: "landscape" })).toBeUndefined();
  // Every genre shelf's genre is one its browse page offers.
  for (const g of GENRES) expect(BROWSE_GENRES[g.type]).toContain(g.genre);
});
