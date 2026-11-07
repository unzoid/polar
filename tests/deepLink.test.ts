import { expect, test } from "bun:test";
import { parseDeepLink, partyPage, watchPage } from "../src/lib/deepLink/deepLink";
import { titleRoute, type TitleLookups } from "../src/lib/deepLink/open";

// polarity:// links from the website's /watch and /party pages (#153).

const TOKEN = "AbCdEfGhIjKlMnOpQrSt-_AbCdEfGhIjKlMnOpQrSt-";

test("a title link opens a movie or a show by an id others' Polarity can open", () => {
  expect(parseDeepLink("polarity://title/series/tt0000000")).toEqual({ kind: "title", type: "series", id: "tt0000000" });
  expect(parseDeepLink("polarity://title/movie/kitsu%3A42")).toEqual({ kind: "title", type: "movie", id: "kitsu:42" });
  for (const bad of [
    "polarity://title/series",
    "polarity://title/channel/tt0000000",
    "polarity://title/movie/tt0000000/extra",
    "polarity://title/movie/file:abc",
    "polarity://title/movie/%E0%A4%A",
    "polarity://title/movie/tt0000000?play=1",
    "polarity://play/movie/tt0000000",
    "polarityx://title/movie/tt0000000",
    "https://getpolar.app/watch/?type=movie&id=tt0000000",
  ]) {
    expect(parseDeepLink(bad)).toBeNull();
  }
});

test("a party link carries a join token, never a party code", () => {
  expect(parseDeepLink(`polarity://party/${TOKEN}`)).toEqual({ kind: "party", token: TOKEN });
  for (const bad of ["polarity://party/K7Q2ZP", `polarity://party/${TOKEN}/x`, `polarity://party/${TOKEN}x`, "polarity://party/"]) {
    expect(parseDeepLink(bad)).toBeNull();
  }
});

test("the buttons' pages on the website", () => {
  expect(watchPage("series", "tt0000000")).toBe("https://getpolar.app/watch/?type=series&id=tt0000000");
  expect(watchPage("movie", "kitsu:42")).toBe("https://getpolar.app/watch/?type=movie&id=kitsu%3A42");
  // Things only this device can open get no button.
  expect(watchPage("movie", "file:abc")).toBeNull();
  expect(watchPage("movie", "link:https://media.example.com/film.mkv")).toBeNull();
  expect(partyPage(TOKEN)).toBe(`https://getpolar.app/party/?t=${TOKEN}`);
});

// The browser extension's links (#208).

test("a title link can carry TMDB's id, which the app looks up", () => {
  expect(parseDeepLink("polarity://title/movie/tmdb%3A603")).toEqual({ kind: "tmdb", type: "movie", id: 603 });
  expect(parseDeepLink("polarity://title/series/tmdb:1399")).toEqual({ kind: "tmdb", type: "series", id: 1399 });
  for (const bad of ["polarity://title/movie/tmdb:0", "polarity://title/movie/tmdb:12a", "polarity://title/movie/tmdb:12345678901", "polarity://title/anime/tmdb:1"]) {
    expect(parseDeepLink(bad)).toBeNull();
  }
  // Still no Discord button for a TMDB id: others' Polarity may have no TMDB key.
  expect(watchPage("movie", "tmdb:603")).toBeNull();
});

test("an anime link carries AniList's or MyAnimeList's id", () => {
  expect(parseDeepLink("polarity://anime/anilist/21")).toEqual({ kind: "anime", source: "anilist", id: 21 });
  expect(parseDeepLink("polarity://anime/mal/5114")).toEqual({ kind: "anime", source: "mal", id: 5114 });
  for (const bad of ["polarity://anime/kitsu/1", "polarity://anime/anilist/", "polarity://anime/anilist/01", "polarity://anime/mal/1/2", "polarity://anime/mal/1?x"]) {
    expect(parseDeepLink(bad)).toBeNull();
  }
});

const together = (q: Record<string, string>) => `polarity://together?${new URLSearchParams(q)}`;

test("a watch-together link carries a video link, a start and the page's title", () => {
  expect(parseDeepLink(together({ u: "https://media.example.com/film.mp4", t: "75", n: "A film" }))).toEqual({
    kind: "together",
    url: "https://media.example.com/film.mp4",
    at: 75,
    name: "A film",
  });
  // A YouTube link comes as the video's one address, as Watch a Link keeps it.
  expect(parseDeepLink(together({ u: "https://youtu.be/AbCdEfGhIjK" }))).toEqual({ kind: "together", url: "https://www.youtube.com/watch?v=AbCdEfGhIjK", at: 0 });
  // The title is one plain line, cut short; a start past a day stops at a day.
  const odd = parseDeepLink(together({ u: "https://media.example.com/a.webm", t: "999999", n: `  Two\nlines‮${"x".repeat(400)}` }));
  expect(odd).toMatchObject({ at: 86400 });
  expect(odd?.kind === "together" && odd.name).toBe(`Two lines${"x".repeat(191)}`);
});

test("a watch-together link with anything else in it is no link", () => {
  for (const q of [
    { u: "javascript:alert(1)" },
    { u: "file:///home/film.mp4" },
    { u: "https://user:pass@media.example.com/film.mp4" },
    { u: `https://media.example.com/${"a".repeat(2100)}.mp4` },
    { u: "https://media.example.com/film.mp4", t: "-5" },
    { u: "https://media.example.com/film.mp4", t: "1.5" },
    { u: "https://media.example.com/film.mp4", play: "1" },
    { t: "5" },
  ]) {
    expect(parseDeepLink(together(q))).toBeNull();
  }
  expect(parseDeepLink("polarity://together?u=https%3A%2F%2Fmedia.example.com%2Fa.mp4&u=https%3A%2F%2Fmedia.example.com%2Fb.mp4")).toBeNull();
  expect(parseDeepLink("polarity://together/https%3A%2F%2Fmedia.example.com%2Fa.mp4")).toBeNull();
});

test("a title link goes to the title's page, through a lookup for TMDB and MyAnimeList ids", async () => {
  const asked: string[] = [];
  const lookups: TitleLookups = {
    imdbForTmdb: async (type, id) => (asked.push(`tmdb ${type} ${id}`), id === 603 ? "tt0000603" : null),
    anilistForMal: async (id) => (asked.push(`mal ${id}`), id === 5114 ? 5114001 : null),
  };
  expect(await titleRoute({ kind: "title", type: "series", id: "kitsu:42" }, lookups)).toEqual({ name: "detail", type: "series", id: "kitsu:42" });
  expect(await titleRoute({ kind: "tmdb", type: "movie", id: 603 }, lookups)).toEqual({ name: "detail", type: "movie", id: "tt0000603" });
  expect(await titleRoute({ kind: "anime", source: "anilist", id: 21 }, lookups)).toEqual({ name: "anime-detail", id: 21 });
  expect(await titleRoute({ kind: "anime", source: "mal", id: 5114 }, lookups)).toEqual({ name: "anime-detail", id: 5114001 });
  expect(asked).toEqual(["tmdb movie 603", "mal 5114"]);
  // No TMDB key (or no IMDb page on TMDB), an anime AniList doesn't know, a lookup that failed: words to show.
  expect(await titleRoute({ kind: "tmdb", type: "series", id: 1 }, lookups)).toContain("TMDB key");
  expect(await titleRoute({ kind: "anime", source: "mal", id: 1 }, lookups)).toContain("AniList doesn't know");
  const down: TitleLookups = { imdbForTmdb: () => Promise.reject(new Error("offline")), anilistForMal: () => Promise.reject(new Error("offline")) };
  expect(await titleRoute({ kind: "tmdb", type: "movie", id: 603 }, down)).toContain("couldn't reach TMDB");
  expect(await titleRoute({ kind: "anime", source: "mal", id: 5114 }, down)).toContain("couldn't reach AniList");
});
