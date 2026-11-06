import { expect, test } from "bun:test";
import type { AnimeCard, MediaFormat } from "../src/lib/anime/anilist";
import { baseTitle } from "../src/lib/anime/baseTitle";

// Invented franchises: entries in chain order, with made-up AniList ids and tt0000000-style links.
const entry = (id: number, format: MediaFormat, year: number, month = 1): AnimeCard => ({
  id,
  title: { romaji: `Kumohane ${id}` },
  coverImage: {},
  format,
  startDate: { year, month, day: 1 },
});
const links = (map: Record<number, string | null>) => (id: number) => (id in map ? map[id] : undefined);

test("a franchise that opens with a prequel film takes the TV series as its base (#246)", () => {
  const film = entry(1, "MOVIE", 2018);
  const s1 = entry(2, "TV", 2019);
  const s2 = entry(3, "TV", 2021);
  const base = baseTitle([film, s1, s2], links({ 2: "tt0000002", 3: "tt0000002" }));
  expect(base).toEqual({ card: s1, imdb: "tt0000002" });
});

test("a film in the middle of a TV run doesn't change the base", () => {
  const s1 = entry(10, "TV", 2015);
  const film = entry(11, "MOVIE", 2016);
  const s2 = entry(12, "TV", 2017);
  expect(baseTitle([s1, film, s2], links({ 10: "tt0000010", 12: "tt0000010" }))?.card).toBe(s1);
  // With no links at all, the earliest-aired TV entry, whatever the chain's order.
  expect(baseTitle([film, s2, s1], links({ 10: null, 12: null }))).toEqual({ card: s1 });
});

test("TV entries split over two IMDb series: the one most of them play from", () => {
  const s1 = entry(20, "TV", 2010);
  const s2 = entry(21, "TV", 2014);
  const s3 = entry(22, "TV", 2016);
  const s4 = entry(23, "TV", 2018);
  const base = baseTitle([s1, s2, s3, s4], links({ 20: "tt0000020", 21: "tt0000021", 22: "tt0000021", 23: "tt0000021" }));
  expect(base).toEqual({ card: s2, imdb: "tt0000021" });
  // A tie goes to the series that aired first.
  const tie = baseTitle([s1, s2, s3, s4], links({ 20: "tt0000020", 21: "tt0000020", 22: "tt0000021", 23: "tt0000021" }));
  expect(tie).toEqual({ card: s1, imdb: "tt0000020" });
});

test("no TV entry: web series first, then the chain's first entry", () => {
  const ova = entry(30, "OVA", 2001);
  const ona = entry(31, "ONA", 2003);
  expect(baseTitle([ova, ona], links({}))).toEqual({ card: ona });
  const film = entry(40, "MOVIE", 2005);
  const sequel = entry(41, "MOVIE", 2007);
  expect(baseTitle([film, sequel], links({}))).toEqual({ card: film });
});

test("waits for every TV entry's link before choosing, so the art doesn't change once drawn", () => {
  const film = entry(50, "MOVIE", 2018);
  const s1 = entry(51, "TV", 2019);
  const s2 = entry(52, "TV", 2021);
  expect(baseTitle([film, s1, s2], links({ 51: "tt0000051" }))).toBeUndefined();
});
