import { expect, test } from "bun:test";
import { joinFacts, kindFacts } from "../src/lib/format";

test("a facts line leaves out what's missing", () => {
  expect(joinFacts(["2021", undefined, "", false, null, 0, "2h 35m"])).toBe("2021 · 2h 35m");
  expect(joinFacts([undefined, ""])).toBe("");
});

test("kind facts: type and the first two genres", () => {
  expect(kindFacts({ type: "movie", genres: ["Drama", "Sci-Fi", "Adventure"] })).toEqual(["Movie", "Drama", "Sci-Fi"]);
  expect(kindFacts({ type: "series" })).toEqual(["Series"]);
});
