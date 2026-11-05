import { expect, test } from "bun:test";
import { isDarkInk } from "../src/components/TitleLogo";

/** RGBA pixels: `n` of each [grey level 0-255, alpha 0-255]. */
function pixels(...runs: [n: number, grey: number, alpha?: number][]) {
  const out: number[] = [];
  for (const [n, grey, alpha = 255] of runs) for (let i = 0; i < n; i++) out.push(grey, grey, grey, alpha);
  return new Uint8ClampedArray(out);
}

test("a logo inked in black becomes the white silhouette", () => {
  expect(isDarkInk(pixels([400, 10], [600, 0, 0]))).toBe(true);
  // Anti-aliased edges and a few lighter specks don't change that.
  expect(isDarkInk(pixels([380, 12], [10, 160], [10, 200, 140], [600, 0, 0]))).toBe(true);
});

test("#11: a dark disc carrying bright letters and a ring keeps its artwork", () => {
  // Average well under the dark line, but a fifth of the ink is bright.
  expect(isDarkInk(pixels([800, 8], [200, 235], [1000, 0, 0]))).toBe(false);
  expect(isDarkInk(pixels([900, 5], [100, 220]))).toBe(false);
});

test("light and mid-tone logos, and nothing to measure, stay as they are", () => {
  expect(isDarkInk(pixels([500, 240]))).toBe(false);
  expect(isDarkInk(pixels([500, 110]))).toBe(false);
  expect(isDarkInk(pixels([500, 0, 0]))).toBe(false);
});
