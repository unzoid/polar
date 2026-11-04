import { expect, test } from "bun:test";
import { isFresh, metacriticTone, scoreTone } from "../src/lib/ui/score";

test("IMDb bands", () => {
  expect([7, 6.9, 5, 4.9].map(scoreTone)).toEqual(["good", "mid", "mid", "low"]);
});

test("Metacritic and Rotten Tomatoes bands", () => {
  expect([61, 60, 40, 39].map(metacriticTone)).toEqual(["good", "mid", "mid", "low"]);
  expect([isFresh(60), isFresh(59)]).toEqual([true, false]);
});
