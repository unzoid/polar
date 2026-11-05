import { expect, test } from "bun:test";
import { glideAt, GLIDE_MS } from "../src/lib/ui/useFoldSnap";

test("the glide to the episodes only ever moves towards its target and lands on it (re-test N8)", () => {
  let last = 0;
  for (let t = 0; t <= GLIDE_MS; t += 16) {
    const y = glideAt(0, 800, t);
    expect(y).toBeGreaterThanOrEqual(last);
    last = y;
  }
  expect(glideAt(0, 800, GLIDE_MS)).toBe(800);
  expect(glideAt(0, 800, GLIDE_MS + 100)).toBe(800);
});

test("a target that moves while gliding (content above still loading) is followed, not restarted", () => {
  // Halfway there the target grows: the position keeps going from where it is, no jump back.
  const before = glideAt(0, 800, GLIDE_MS / 2);
  const after = glideAt(0, 900, GLIDE_MS / 2 + 16);
  expect(after).toBeGreaterThan(before);
  expect(glideAt(0, 900, GLIDE_MS)).toBe(900);
});

test("upwards too", () => {
  expect(glideAt(800, 0, 0)).toBe(800);
  expect(glideAt(800, 0, GLIDE_MS)).toBe(0);
  expect(glideAt(800, 0, GLIDE_MS / 2)).toBeLessThan(800);
});
