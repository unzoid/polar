import { afterEach, expect, test } from "bun:test";

const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const { genreShelf, GENRE_FIRST } = await import("../src/lib/anime/anilist");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("each genre shelf is its own request, so one never waits for another (re-test 21)", async () => {
  const asked: { genre: string; perPage: number }[] = [];
  let release!: () => void;
  const slow = new Promise<void>((r) => (release = r));
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const { query, variables } = JSON.parse(init.body);
    asked.push({ genre: variables.genre, perPage: Number(/perPage: (\d+)/.exec(query)?.[1]) });
    if (variables.genre === "Drama") await slow;
    return new Response(JSON.stringify({ data: { Page: { media: [] } } }), { status: 200 });
  }) as typeof fetch;
  const drama = genreShelf("Drama", GENRE_FIRST);
  const comedy = await genreShelf("Comedy", GENRE_FIRST);
  // Comedy is in although Drama hasn't answered.
  expect(comedy).toEqual([]);
  expect(asked).toEqual([
    { genre: "Drama", perPage: GENRE_FIRST },
    { genre: "Comedy", perPage: GENRE_FIRST },
  ]);
  release();
  await drama;
});

test("the first cards come in a small request; the rest of the row after them", () => {
  expect(GENRE_FIRST).toBeLessThanOrEqual(8);
});
