import { expect, spyOn, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AnimeRelated } from "../../src/components/anime/AnimeRelated";
import { useTrailerOpen } from "../../src/components/Trailer";
import { api } from "../../src/lib/api";
import { aniZipQuery, type Anime, type AnimeCard as Media } from "../../src/lib/anime";
import { keys } from "../../src/lib/net";
import { setPrefs } from "../../src/lib/settings/prefs";
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

// Also in This Franchise's entries Polarity can't play (#192), in the same invented franchise.
const novel = { ...entry(910011, "NOVEL", "Harbour Lights: The Novel"), type: "MANGA", idMal: 4242 } as Media;
const musicVideo = { ...entry(910012, "MUSIC", "Harbour Lights Theme"), externalLinks: [{ site: "YouTube", url: "https://youtu.be/AAAAAAAAAAA" }] } as Media;
const webShort = { ...entry(910013, "ONA", "Harbour Lights Minis"), externalLinks: [{ site: "YouTube", url: "https://www.youtube.com/watch?v=BBBBBBBBBBB" }] } as Media;
const pv = { ...entry(910014, "MUSIC", "Harbour Lights PV"), idMal: 77 } as Media;
const withOthers = {
  ...s2,
  relations: { edges: [novel, musicVideo, webShort, pv, spinOff].map((node) => ({ relationType: "SIDE_STORY", node })) },
  recommendations: { nodes: [] },
} as unknown as Anime;

function TrailerProbe() {
  return <data>{useTrailerOpen()?.ytId ?? ""}</data>;
}

test("Also in This Franchise: manga and novels open on the chosen site, music videos and YouTube-only shorts play from YouTube (#192)", async () => {
  const qc = new QueryClient();
  qc.setQueryData(keys.animeLinks, []);
  for (const e of [novel, musicVideo, webShort, pv, spinOff]) qc.setQueryData(keys.anime.listedImdb(e.id), null);
  // ani.zip doesn't know the web short; the spin-off has no YouTube video, so it isn't asked about.
  qc.setQueryData(aniZipQuery(webShort.id).queryKey, null);
  const opened: string[] = [];
  const external = spyOn(api, "openExternal").mockImplementation(async (url) => void opened.push(url));
  const { container, unmount } = await render(
    <QueryClientProvider client={qc}>
      <RouterProvider>
        <AnimeRelated anime={withOthers} />
        <Where />
        <TrailerProbe />
      </RouterProvider>
    </QueryClientProvider>,
  );
  await settle();
  const row = () => [...container.querySelectorAll(".row")].find((r) => r.textContent?.includes("Also in This Franchise"))!;
  const cardOf = (name: string) => [...row().querySelectorAll(".anime-card")].find((c) => c.textContent?.includes(name))!;
  const badge = (name: string) => cardOf(name).querySelector(".card-kind-badge")?.textContent;
  expect(badge("The Novel")).toBe("Light novel");
  expect(badge("Theme")).toBe("Music video");
  expect(badge("Minis")).toBe("ONA");
  const caption = (name: string) => cardOf(name).querySelector(".card-caption .t-caption")?.textContent;
  expect(caption("Theme")).toBe("Side Story · Music · YouTube");
  expect(caption("Minis")).toBe("Side Story · ONA · YouTube");
  expect(badge("PV")).toBe("Music video");
  expect(badge("Kitchen")).toBeUndefined();

  await click(cardOf("The Novel"));
  await click(cardOf("PV"));
  expect(opened).toEqual(["https://myanimelist.net/manga/4242", "https://myanimelist.net/anime/77"]);
  await act(async () => setPrefs({ animeReadOn: "anilist" }, { quiet: true }));
  await click(cardOf("The Novel"));
  expect(opened.at(-1)).toBe("https://anilist.co/manga/910011");

  await click(cardOf("Theme"));
  expect(container.querySelector("data")!.textContent).toBe("AAAAAAAAAAA");
  await click(cardOf("Minis"));
  expect(container.querySelector("data")!.textContent).toBe("BBBBBBBBBBB");
  const home = container.querySelector("output")!.textContent;
  await click(cardOf("Kitchen"));
  expect(container.querySelector("output")!.textContent).not.toBe(home);

  // Only shows and films: what Polarity can't play leaves the row.
  await act(async () => setPrefs({ animeHideUnplayable: true }, { quiet: true }));
  expect([...row().querySelectorAll(".card-title")].map((t) => t.textContent)).toEqual(["Harbour Lights Kitchen"]);
  await act(async () => setPrefs({ animeReadOn: "myanimelist", animeHideUnplayable: false }, { quiet: true }));
  external.mockRestore();
  await unmount();
});
