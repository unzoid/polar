import { expect, test } from "bun:test";
import { trailerFor, trailerSourceLabel } from "../src/lib/playback/trailers";

test("TMDB's trailer plays before IMDb's file", () => {
  expect(trailerFor("Sandglass", "tt0000106", { trailerYtId: "abc", trailerSource: "tmdb" })).toEqual({
    name: "Sandglass",
    imdbId: "tt0000106",
    ytId: "abc",
    ytFirst: true,
    ytFrom: "TMDB",
  });
});

test("an addon's YouTube trailer only after IMDb's file", () => {
  expect(trailerFor("Sandglass", "tt0000106", { trailerYtId: "abc" }).ytFirst).toBe(false);
  expect(trailerFor("Sandglass", "tt0000106").ytFirst).toBe(false);
});

test("only IMDb ids look for a file", () => {
  expect(trailerFor("Elsewind", "kitsu:46474", { trailerYtId: "abc" }).imdbId).toBeUndefined();
});

test("the trailer player says whose trailer it is (test report 1, item 27)", () => {
  expect(trailerSourceLabel(trailerFor("Sandglass", "tt0000106", { trailerYtId: "abc", trailerSource: "tmdb" }), "youtube")).toBe("TMDB · YouTube");
  expect(trailerSourceLabel(trailerFor("Sandglass", "tt0000106"), "file")).toBe("IMDb");
  expect(trailerSourceLabel({ ytFrom: "AniList" }, "youtube")).toBe("AniList · YouTube");
  expect(trailerSourceLabel({}, "youtube")).toBe("YouTube");
});
