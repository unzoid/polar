import { expect, test } from "bun:test";
import { flagMap, slug } from "../src/lib/anime/episodeFlags";

test("animefillerlist slugs", () => {
  expect(slug("Kazeori: Arashi-hen")).toBe("kazeori-arashi-hen");
  expect(slug("  Salt Horizon! ")).toBe("salt-horizon");
});

test("flag lists become a map by episode", () => {
  const m = flagMap({ filler: [2, 5], recap: [5, 9], source: "jikan" });
  expect([...m.keys()].sort((a, b) => a - b)).toEqual([2, 5, 9]);
  expect(m.get(2)).toEqual({ filler: true, recap: false });
  expect(m.get(5)).toEqual({ filler: true, recap: true });
  expect(m.get(9)).toEqual({ filler: false, recap: true });
});
