import { expect, test } from "bun:test";
import type { AnimeCard, MediaFormat } from "../src/lib/anime/anilist";
import { bannerBase } from "../src/lib/anime/franchiseBanner";

// Invented franchises: entries in chain order, with made-up AniList ids and tt0000000-style links.
const entry = (id: number, format: MediaFormat, year: number, english: string): AnimeCard => ({
  id,
  title: { english },
  coverImage: {},
  format,
  startDate: { year, month: 1, day: 1 },
});
const links = (map: Record<number, string | null>) => (id: number) => (id in map ? map[id] : undefined);
const title = (t: AnimeCard["title"]) => t.english ?? "";

const film = entry(1, "MOVIE", 2018, "Reed Harbor: First Light");
const s1 = entry(2, "TV", 2019, "Reed Harbor");
const s2 = entry(3, "TV", 2021, "Reed Harbor: Second Tide");
const seasons = [
  { card: film, label: "Movie" },
  { card: s1, label: "Season 1" },
  { card: s2, label: "Season 2" },
];
const linked = links({ 1: null, 2: "tt0000002", 3: "tt0000002" });

test("a later season's banner takes the base title and its linked series, named by its season tab (#325)", () => {
  expect(bannerBase(s2, seasons, linked, title)).toEqual({ base: s1, imdb: "tt0000002", label: "Second Tide" });
});

test("the base title itself has no label, even after a prequel film in the chain", () => {
  expect(bannerBase(s1, seasons, linked, title)).toEqual({ base: s1, imdb: "tt0000002" });
});

test("a prequel film trending is named as its tab is, Movie, and shows the series it belongs to", () => {
  expect(bannerBase(film, seasons, linked, title)).toEqual({ base: s1, imdb: "tt0000002", label: "Movie" });
});

test("an entry on its own is its own base; nothing until its link is known", () => {
  const solo = entry(9, "TV", 2020, "Mossgate");
  expect(bannerBase(solo, [{ card: solo, label: "Season 1" }], links({ 9: "tt0000009" }), title)).toEqual({ base: solo, imdb: "tt0000009" });
  expect(bannerBase(solo, [{ card: solo, label: "Season 1" }], links({}), title)).toBeUndefined();
  expect(bannerBase(s2, seasons, links({ 1: null, 2: "tt0000002" }), title)).toBeUndefined();
});

test("a base with no linked series: its ani.zip art (null), the later season's own link standing in as the page does", () => {
  const none = links({ 1: null, 2: null, 3: null });
  expect(bannerBase(s2, seasons, none, title)).toEqual({ base: s1, imdb: null, label: "Second Tide" });
});
