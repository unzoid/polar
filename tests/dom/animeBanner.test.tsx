import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFranchiseBanners, type Anime, type AnimeCard as Media, type BannerArt, type SeasonWalk } from "../../src/lib/anime";
import { keys } from "../../src/lib/net";
import { setPrefs } from "../../src/lib/settings/prefs";
import { render } from "./render";

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));

// An invented franchise: Season 1 (its base title) and Season 2, both linked to one made-up IMDb series.
const entry = (id: number, name: string, year: number) =>
  ({
    id,
    type: "ANIME",
    format: "TV",
    title: { english: name, romaji: null, native: null },
    coverImage: { extraLarge: `https://art.example/cover/${id}.jpg` },
    bannerImage: `https://art.example/banner/${id}.jpg`,
    startDate: { year, month: 1, day: 1 },
  }) as unknown as Media;
const s1 = entry(920001, "Lantern Coast", 2017);
const s2 = entry(920002, "Lantern Coast Season 2", 2019);
const series = "tt0000920";
const general = { background: "https://art.example/background/tt0000920.jpg", logo: "https://art.example/logo/tt0000920.png" };
const walk: SeasonWalk = {
  seasons: [
    { card: s1, label: "Season 1" },
    { card: s2, label: "Season 2" },
  ],
  order: [s1, s2],
  complete: true,
};

function client() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(keys.animeLinks, []);
  for (const e of [s1, s2]) {
    qc.setQueryData(keys.anime.media(e.id), { ...e, relations: { edges: [] } } as unknown as Anime);
    qc.setQueryData(keys.anime.seasons(e.id), walk);
    qc.setQueryData(keys.anime.listedImdb(e.id), series);
    qc.setQueryData(keys.aniZip(e.id), { mappings: {}, episodes: {}, images: [] });
  }
  qc.setQueryData(keys.meta("series", series), { id: series, type: "series", name: "Lantern Coast", ...general });
  return qc;
}

async function banners(cards: Media[]) {
  let out: (BannerArt | null)[] | undefined;
  function Probe() {
    out = useFranchiseBanners(cards);
    return null;
  }
  const { unmount } = await render(
    <QueryClientProvider client={client()}>
      <Probe />
    </QueryClientProvider>,
  );
  await settle();
  await unmount();
  return out;
}

afterEach(() => setPrefs({ animeSeparateEntries: false }));

test("with seasons grouped, a trending base title shows its franchise's art and logo and no label (#325)", async () => {
  setPrefs({ animeSeparateEntries: false });
  expect(await banners([s1])).toEqual([{ name: "Lantern Coast", ...general, label: undefined }]);
});

test("a later season trending shows the base title's art and logo, the same as its page, and its season tab's label", async () => {
  setPrefs({ animeSeparateEntries: false });
  expect(await banners([s2])).toEqual([{ name: "Lantern Coast", ...general, label: "Season 2" }]);
});

test("with seasons as separate shows, every entry keeps its own art", async () => {
  setPrefs({ animeSeparateEntries: true });
  expect(await banners([s1, s2])).toEqual([null, null]);
});
