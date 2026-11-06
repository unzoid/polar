import { expect, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AnimeSeriesPick } from "../../src/components/anime/AnimeSeriesPick";
import type { AnimeCard } from "../../src/lib/anime";
import { keys } from "../../src/lib/net";
import { click, render } from "./render";

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));

const show = {
  id: 900101,
  type: "ANIME",
  format: "TV",
  title: { english: null, romaji: "Hoshikuzu Ryokou-dan", native: null },
  coverImage: { extraLarge: null, large: null, color: null },
} as unknown as AnimeCard;

const found = {
  series: [
    { id: "tt0000901", type: "series", name: "Stardust Wanderers", releaseInfo: "2026-" },
    { id: "kitsu:5", type: "series", name: "Hoshikuzu Ryokou-dan" },
  ],
  movies: [{ id: "tt0000902", type: "movie", name: "Stardust Wanderers: The Film", releaseInfo: "2027" }],
};

async function open(current?: string) {
  const qc = new QueryClient();
  qc.setQueryData(keys.search("Hoshikuzu Ryokou-dan"), found);
  qc.setQueryData(keys.anime.imdb(show.id), null);
  const view = await render(
    <QueryClientProvider client={qc}>
      <AnimeSeriesPick anime={show} isMovie={false} current={current} />
    </QueryClientProvider>,
  );
  const trigger = view.container.querySelector("button")!;
  await click(trigger);
  await settle();
  return { qc, view, trigger };
}

test("AnimeSeriesPick: an unlinked anime offers its series by its name, IMDb titles of its kind only (#189)", async () => {
  const { qc, view, trigger } = await open();
  expect(trigger.textContent).toBe("Choose the series");
  const panel = document.querySelector(".anime-pick")!;
  expect(panel.querySelector("input")!.value).toBe("Hoshikuzu Ryokou-dan");
  const items = [...panel.querySelectorAll(".anime-pick-item")];
  expect(items.map((i) => i.querySelector(".anime-pick-name")!.textContent)).toEqual(["Stardust Wanderers"]);
  await click(items[0]);
  await settle();
  // The pick is stored as the entry's link, and the page asks again which show it plays from.
  expect(qc.getQueryState(keys.anime.imdb(show.id))?.isInvalidated).toBe(true);
  expect(document.querySelector(".anime-pick")).toBeNull();
  await view.unmount();
});

test("AnimeSeriesPick: a show linked by title can be changed, the current one marked", async () => {
  const { view, trigger } = await open("tt0000901");
  expect(trigger.textContent).toBe("Wrong series?");
  expect(document.querySelector(".anime-pick-item")!.getAttribute("aria-current")).toBe("true");
  await view.unmount();
});
