import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AnimeRelated } from "../../src/components/anime/AnimeRelated";
import type { Anime } from "../../src/lib/anime";
import { RouterProvider } from "../../src/lib/router";
import { render } from "./render";

const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

const card = (id: number, english: string) => ({ id, type: "ANIME", title: { english, romaji: null, native: null }, coverImage: {}, chain: [] });
const shows = ["Paleblade", "Elsewind", "Kazeori", "Lantern Keepers", "Mr. Pebble", "Sky Lantern", "Arashi", "Garasu", "Hoshizora", "Tsukimi", "Yukihana"];

function page(names: string[], hasNextPage: boolean, from: number) {
  return { nodes: names.map((n, i) => ({ rating: 100 - i, mediaRecommendation: card(from + i, n) })), hasNextPage };
}

/** An entry whose first page of recommendations is mostly its own sequel seasons. */
function anime(hasNextPage: boolean): Anime {
  const own = Array.from({ length: 20 }, (_, i) => card(100 + i, `Tower of Glass Season ${i + 2}`));
  return {
    ...card(1, "Tower of Glass"),
    relations: { edges: [] },
    recommendations: { nodes: [...own.map((c) => ({ rating: 500, mediaRecommendation: c })), ...page(shows.slice(0, 3), false, 10).nodes], hasNextPage },
  } as unknown as Anime;
}

/** AniList stand-in for the second page: counts requests. */
function fakeAniList() {
  const asked: string[] = [];
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const { query } = JSON.parse(init.body);
    asked.push(query);
    const recommendations = { pageInfo: { hasNextPage: false }, nodes: page(shows.slice(3), false, 20).nodes };
    return new Response(JSON.stringify({ data: { Media: { recommendations } } }), { status: 200 });
  }) as unknown as typeof fetch;
  return asked;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  localStorage.clear();
});

const titles = (root: HTMLElement) => [...root.querySelectorAll(".row")].find((r) => r.textContent?.includes("If You Liked This"));

test("If You Liked This leaves out the show's own seasons and asks for the next page when too few are left (#191)", async () => {
  const asked = fakeAniList();
  const { container, unmount } = await render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider>
        <AnimeRelated anime={anime(true)} />
      </RouterProvider>
    </QueryClientProvider>,
  );
  await settle();
  expect(asked.length).toBe(1);
  expect(asked[0]).toContain("page: 2");
  const row = titles(container)!;
  expect(row.textContent).not.toContain("Tower of Glass");
  for (const name of shows) expect(row.textContent).toContain(name);
  await unmount();
});

test("If You Liked This doesn't ask again when AniList had no more (#191)", async () => {
  const asked = fakeAniList();
  const { container, unmount } = await render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider>
        <AnimeRelated anime={anime(false)} />
      </RouterProvider>
    </QueryClientProvider>,
  );
  await settle();
  expect(asked).toEqual([]);
  expect(titles(container)!.textContent).toContain("Paleblade");
  await unmount();
});
