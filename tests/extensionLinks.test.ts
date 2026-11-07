import { expect, test } from "bun:test";
import { openPage, togetherPage } from "../extension/src/ids";
import { joinLink, titleLink, togetherLink } from "../web/src/lib/appLinks";
import { parseDeepLink } from "../src/lib/deepLink/deepLink";

// The browser extension's buttons (#208) through the website's pages to the app: each hop checks the
// link, and what the extension makes arrives as it meant it.

const handOver = (page: string) => {
  const u = new URL(page);
  const link = u.pathname === "/watch/" ? titleLink(u.search) : u.search ? joinLink(u.search) : togetherLink(u.hash);
  return link && parseDeepLink(link);
};

test("Open in Polarity reaches the app as the same title", () => {
  expect(handOver(openPage({ db: "imdb", type: "movie", id: "tt0000001" }))).toEqual({ kind: "title", type: "movie", id: "tt0000001" });
  expect(handOver(openPage({ db: "tmdb", type: "series", id: 77 }))).toEqual({ kind: "tmdb", type: "series", id: 77 });
  expect(handOver(openPage({ db: "anilist", id: 21 }))).toEqual({ kind: "anime", source: "anilist", id: 21 });
  expect(handOver(openPage({ db: "mal", id: 5114 }))).toEqual({ kind: "anime", source: "mal", id: 5114 });
  // Discord's buttons (#153) still go through the same page.
  expect(handOver("https://getpolar.app/watch/?type=series&id=kitsu%3A42")).toEqual({ kind: "title", type: "series", id: "kitsu:42" });
});

test("Watch together reaches the app as the same video, start and page title", () => {
  expect(handOver(togetherPage("https://www.youtube.com/watch?v=abc-DEF_123", 42, "An open film - YouTube"))).toEqual({
    kind: "together",
    url: "https://www.youtube.com/watch?v=abc-DEF_123",
    at: 42,
    name: "An open film",
  });
  expect(handOver(togetherPage("https://media.example.com/a b/film.mp4?x=1&y=2"))).toEqual({ kind: "together", url: "https://media.example.com/a%20b/film.mp4?x=1&y=2", at: 0 });
});

test("the website's pages make no link from anything else", () => {
  for (const search of ["?type=movie&id=file:abc", "?type=anime&id=kitsu:1", "?type=anime&id=anilist:0", "?type=channel&id=tt0000001", ""]) {
    expect(titleLink(search)).toBeNull();
  }
  for (const hash of ["", "#u=javascript%3Aalert(1)", "#u=https%3A%2F%2Fuser%3Apass%40media.example.com%2Ffilm.mp4", "#u=https%3A%2F%2Fmedia.example.com%2Ffilm.mp4&t=-1"]) {
    expect(togetherLink(hash)).toBeNull();
  }
  // A Discord join link's query wins over any fragment.
  expect(handOver("https://getpolar.app/party/?t=AbCdEfGhIjKlMnOpQrSt-_AbCdEfGhIjKlMnOpQrSt-#u=https%3A%2F%2Fmedia.example.com%2Ffilm.mp4")).toMatchObject({ kind: "party" });
});
