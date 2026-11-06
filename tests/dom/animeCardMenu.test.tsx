import { expect, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CardMenuHost } from "../../src/components/CardMenu";
import { AnimeCard, useAnimeHandlers } from "../../src/components/anime/AnimeCard";
import { aniZipQuery, type AnimeCard as Media } from "../../src/lib/anime";
import { keys } from "../../src/lib/net";
import { RouterProvider } from "../../src/lib/router";
import { render } from "./render";

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));

const upcoming = {
  id: 900001,
  type: "ANIME",
  format: "TV",
  title: { english: "The Lantern Keepers", romaji: null, native: null },
  coverImage: { extraLarge: null, large: null, color: null },
} as unknown as Media;

function Card({ item }: { item: Media }) {
  return <button {...useAnimeHandlers()(item)}>{item.title.english}</button>;
}

test("AnimeCard: right-click opens the menu for an anime with no IMDb or Kitsu link, with only what needs no link (#39)", async () => {
  const qc = new QueryClient();
  qc.setQueryData(aniZipQuery(upcoming.id).queryKey, { mappings: { anilist_id: upcoming.id }, episodes: {} });
  const { container, unmount } = await render(
    <QueryClientProvider client={qc}>
      <RouterProvider>
        <Card item={upcoming} />
        <CardMenuHost />
      </RouterProvider>
    </QueryClientProvider>,
  );
  const card = container.querySelector("button")!;
  await act(async () => void card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })));
  await settle();
  const menu = document.querySelector("[role=menu]");
  expect(menu).not.toBeNull();
  expect(menu!.getAttribute("aria-label")).toBe("The Lantern Keepers options");
  expect([...menu!.querySelectorAll("[role^=menuitem]")].map((i) => i.textContent)).toEqual(["Go to Show"]);
  await unmount();
});

test("AnimeCard: every season of a show linked to one IMDb title shows that title's poster, not its own cover (#27)", async () => {
  const season = (id: number, name: string) =>
    ({ ...upcoming, id, title: { english: name, romaji: null, native: null }, coverImage: { extraLarge: `https://art.example/${id}.jpg`, large: null, color: null } }) as Media;
  const qc = new QueryClient();
  qc.setQueryData(keys.animeLinks, [{ canonical: "tt0000001", anilist: 900002, updatedAt: 1 }]);
  qc.setQueryData(keys.anime.listedImdb(900002), null);
  qc.setQueryData(keys.anime.listedImdb(900003), "tt0000001");
  qc.setQueryData(keys.anime.listedImdb(900004), null);
  const { container, unmount } = await render(
    <QueryClientProvider client={qc}>
      <RouterProvider>
        <AnimeCard item={season(900002, "The Lantern Keepers")} />
        <AnimeCard item={season(900003, "The Lantern Keepers Season 2")} />
        <AnimeCard item={season(900004, "Unlinked")} />
      </RouterProvider>
    </QueryClientProvider>,
  );
  await settle();
  const srcs = [...container.querySelectorAll("img")].map((i) => i.getAttribute("src"));
  const poster = "https://images.metahub.space/poster/medium/tt0000001/img";
  expect(srcs).toEqual([poster, poster, "https://art.example/900004.jpg"]);
  await unmount();
});
