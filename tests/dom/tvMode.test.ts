import { expect, test } from "bun:test";
import { startsInTvMode } from "../../src/tv/tvMode";

test("TV mode at start: always on a TV, elsewhere as last left", () => {
  expect(startsInTvMode(null, true)).toBe(true);
  expect(startsInTvMode("0", true)).toBe(true);
  expect(startsInTvMode("1", false)).toBe(true);
  expect(startsInTvMode("0", false)).toBe(false);
  expect(startsInTvMode(null, false)).toBe(false);
});
