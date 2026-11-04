import { expect, test } from "bun:test";
import { trailerFor } from "../src/lib/playback/trailers";

test("TMDB's trailer plays before IMDb's file", () => {
  expect(trailerFor("Sandglass", "tt0000106", { trailerYtId: "abc", trailerSource: "tmdb" })).toEqual({
    name: "Sandglass",
    imdbId: "tt0000106",
    ytId: "abc",
    ytFirst: true,
  });
});

test("an addon's YouTube trailer only after IMDb's file", () => {
  expect(trailerFor("Sandglass", "tt0000106", { trailerYtId: "abc" }).ytFirst).toBe(false);
  expect(trailerFor("Sandglass", "tt0000106").ytFirst).toBe(false);
});

test("only IMDb ids look for a file", () => {
  expect(trailerFor("Elsewind", "kitsu:46474", { trailerYtId: "abc" }).imdbId).toBeUndefined();
});
