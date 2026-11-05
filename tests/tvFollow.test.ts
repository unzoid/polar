import { expect, test } from "bun:test";
import { followStep, glideScroll, glideTarget } from "../src/tv/follow";

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

test("a glide lands on its target where the scroll offset snaps to whole pixels, and a held key adds to where it's heading", () => {
  // Frames by hand; an element whose scrollTop rounds like WebKit's at DPR 1.
  const frames: FrameRequestCallback[] = [];
  const g = globalThis as Record<string, unknown>;
  const saved = { raf: g.requestAnimationFrame, doc: g.document, win: g.window };
  g.requestAnimationFrame = (cb: FrameRequestCallback) => frames.push(cb);
  g.document = { documentElement: { dataset: { reduceMotion: "off" } } };
  let top = 0;
  const el = { scrollHeight: 5000, clientHeight: 500, style: {} as CSSStyleDeclaration } as unknown as HTMLElement;
  Object.defineProperty(el, "scrollTop", { get: () => top, set: (v: number) => void (top = Math.round(v)) });
  try {
    let now = performance.now();
    glideScroll(el, "y", 400);
    glideScroll(el, "y", (glideTarget(el, "y") ?? el.scrollTop) + 200);
    expect(glideTarget(el, "y")).toBe(600);
    for (let f = 0; f < 600 && frames.length; f++) frames.shift()!((now += 8));
    expect(top).toBe(600);
    expect(frames.length).toBe(0); // landed: no frame keeps running
    expect(glideTarget(el, "y")).toBeUndefined();
  } finally {
    g.requestAnimationFrame = saved.raf;
    g.document = saved.doc;
    g.window = saved.win;
  }
});
