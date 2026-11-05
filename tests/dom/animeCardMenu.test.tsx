import { expect, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CardMenuHost } from "../../src/components/CardMenu";
import { useAnimeHandlers } from "../../src/components/anime/AnimeCard";
import { aniZipQuery, type AnimeCard } from "../../src/lib/anime";
import { RouterProvider } from "../../src/lib/router";
import { render } from "./render";

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));

const upcoming = {
  id: 900001,
  type: "ANIME",
  format: "TV",
  title: { english: "The Lantern Keepers", romaji: null, native: null },
  coverImage: { extraLarge: null, large: null, color: null },
} as unknown as AnimeCard;

function Card({ item }: { item: AnimeCard }) {
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
