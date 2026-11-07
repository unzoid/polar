import { expect, test } from "bun:test";
import { parseDeepLink, partyPage, watchPage } from "../src/lib/deepLink/deepLink";

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
