import { expect, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AnimeRelated } from "../../src/components/anime/AnimeRelated";
import type { Anime, AnimeCard as Media } from "../../src/lib/anime";
import { keys } from "../../src/lib/net";
import { RouterProvider, useRouter } from "../../src/lib/router";
import { click, render } from "./render";

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));

// An invented franchise: Season 1, an OVA between seasons, Season 2 (on screen), and a spin-off off the chain.
const entry = (id: number, format: string, name: string) =>
  ({ id, type: "ANIME", format, title: { english: name, romaji: null, native: null }, coverImage: {} }) as unknown as Media;
const s1 = entry(910001, "TV", "Harbour Lights");
const ova = entry(910002, "OVA", "Harbour Lights: Fog Night");
const s2 = entry(910003, "TV", "Harbour Lights Season 2");
const spinOff = entry(910004, "ONA", "Harbour Lights Kitchen");
const anime = {
  ...s2,
  relations: {
    edges: [
      { relationType: "PREQUEL", node: ova },
      { relationType: "SPIN_OFF", node: spinOff },
      { relationType: "ALTERNATIVE", node: s1 },
    ],
  },
  recommendations: { nodes: [] },
} as unknown as Anime;

function Where() {
  const { current } = useRouter();
  return <output>{current.name === "anime-detail" ? current.id : current.name}</output>;
}

test("a franchise page's Watch Order switches tabs for its own seasons and opens pages only for the rest (#193)", async () => {
  const qc = new QueryClient();
  qc.setQueryData(keys.animeLinks, []);
  for (const e of [s1, ova, s2, spinOff]) qc.setQueryData(keys.anime.listedImdb(e.id), null);
  const selected: number[] = [];
  const franchise = {
    seasons: [
      { card: s1, label: "Season 1" },
      { card: s2, label: "Season 2" },
    ],
    order: [s1, ova, s2],
    active: s2.id,
    select: (id: number) => void selected.push(id),
  };
  const { container, unmount } = await render(
    <QueryClientProvider client={qc}>
      <RouterProvider>
        <AnimeRelated anime={anime} franchise={franchise} />
        <Where />
      </RouterProvider>
    </QueryClientProvider>,
  );
  await settle();
  const row = (title: string) => [...container.querySelectorAll(".row")].find((r) => r.textContent?.includes(title))!;
  const titles = (r: Element) => [...r.querySelectorAll(".card-title")].map((t) => t.textContent);
  expect(titles(row("Watch Order"))).toEqual(["Harbour Lights", "Harbour Lights: Fog Night", "Harbour Lights Season 2"]);
  expect(titles(row("Also in This Franchise"))).toEqual(["Harbour Lights Kitchen"]);
  const where = () => container.querySelector("output")!.textContent;
  const home = where();

  const cards = row("Watch Order").querySelectorAll(".anime-card");
  expect(cards[2].getAttribute("aria-current")).toBe("true");
  await click(cards[0]);
  expect(selected).toEqual([s1.id]);
  expect(where()).toBe(home);

  await click(cards[1]);
  expect(selected).toEqual([s1.id]);
  expect(where()).toBe(String(ova.id));
  await unmount();
});
