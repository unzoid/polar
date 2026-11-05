import { expect, test } from "bun:test";
import { followStep } from "../src/tv/follow";

test("a held direction glides: each frame closes part of the gap, never overshoots, then lands (re-test 20)", () => {
  let y = 0;
  const seen: number[] = [];
  for (let f = 0; f < 60; f++) {
    y = followStep(y, 400, 16);
    seen.push(y);
  }
  for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
  expect(Math.max(...seen)).toBeLessThanOrEqual(400);
  expect(y).toBe(400);
  // No single frame jumps a whole row: the first frame covers well under half of 400 px.
  expect(seen[0]).toBeLessThan(200);
});

test("a target moved on (the next row while held) is followed from where the glide is, without a stop", () => {
  let y = followStep(followStep(0, 400, 16), 400, 16);
  const before = y;
  y = followStep(y, 800, 16);
  expect(y).toBeGreaterThan(before);
});
