import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { genreShelf, useAnimeGenre } from "../../src/lib/anime";
import { anilistLimiter } from "../../src/lib/net";
import { render } from "./render";

const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

const hit = (id: number) => ({ id, type: "ANIME", title: { english: `Lantern ${id}`, romaji: null, native: null }, coverImage: {}, relations: { edges: [] } });

/** AniList stand-in: counts requests and answers each with `perPage` made-up entries. */
function fakeAniList() {
  const asked: { genre: string; perPage: number }[] = [];
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const { query, variables } = JSON.parse(init.body);
    const perPage = Number(/perPage: (\d+)/.exec(query)?.[1]);
    asked.push({ genre: variables.genre, perPage });
    const media = Array.from({ length: perPage }, (_, i) => hit(i + 1));
    return new Response(JSON.stringify({ data: { Page: { media } } }), { status: 200 });
  }) as unknown as typeof fetch;
  return asked;
}

function Row({ genre, near }: { genre: string; near: boolean }) {
  const { data } = useAnimeGenre(genre, near);
  return <p>{data ? data.length : "loading"}</p>;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  anilistLimiter.setLimit(90);
  localStorage.clear();
});

test("a genre row the device kept draws at once, before it's near and without asking AniList (#109)", async () => {
  const asked = fakeAniList();
  await genreShelf("Mystery", 24);
  asked.length = 0;
  const { container, unmount } = await render(
    <QueryClientProvider client={new QueryClient()}>
      <Row genre="Mystery" near={false} />
    </QueryClientProvider>,
  );
  expect(container.textContent).toBe("24");
  await settle();
  expect(asked).toEqual([]);
  await unmount();
});

test("while AniList is degraded, a row comes in one request instead of first cards then the rest (#109)", async () => {
  const asked = fakeAniList();
  anilistLimiter.setLimit(30);
  const { container, unmount } = await render(
    <QueryClientProvider client={new QueryClient()}>
      <Row genre="Drama" near />
    </QueryClientProvider>,
  );
  await settle();
  await settle();
  expect(container.textContent).toBe("24");
  expect(asked).toEqual([{ genre: "Drama", perPage: 24 }]);
  await unmount();
});

test("at AniList's normal limit, the first cards come first, then the rest of the row", async () => {
  const asked = fakeAniList();
  const { container, unmount } = await render(
    <QueryClientProvider client={new QueryClient()}>
      <Row genre="Comedy" near />
    </QueryClientProvider>,
  );
  await settle();
  await settle();
  expect(container.textContent).toBe("24");
  expect(asked.map((a) => a.perPage)).toEqual([8, 24]);
  await unmount();
});
