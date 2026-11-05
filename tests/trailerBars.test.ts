import { expect, test } from "bun:test";
import { barsZoom, findBars } from "../src/lib/playback/trailerBars";

/** A w × h frame: grey picture inside black bars of the given sizes (pixels). */
function frame(w: number, h: number, bars: { top?: number; bottom?: number; left?: number; right?: number }, picture = 128) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inside = y >= (bars.top ?? 0) && y < h - (bars.bottom ?? 0) && x >= (bars.left ?? 0) && x < w - (bars.right ?? 0);
      const i = (y * w + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = inside ? picture : 4;
      px[i + 3] = 255;
    }
  return px;
}

test("bars inside a trailer are found and zoomed away (test report 1, item 16)", () => {
  // Pillarboxed: a 4:3 picture in a 16:9 frame, 160×90 sample, 20 px each side.
  const pillar = findBars(frame(160, 90, { left: 20, right: 20 }), 160, 90)!;
  expect(pillar).toEqual({ top: 0, bottom: 0, left: 0.125, right: 0.125 });
  // In a 16:9 window: zoomed by 4/3 (and a hair), centred.
  const z = barsZoom(pillar, 16 / 9, 16 / 9)!;
  expect(z.scale).toBeCloseTo((4 / 3) * 1.01, 3);
  expect(z.x).toBeCloseTo(0);
  // Letterboxed 2.39:1 inside 16:9, in a 21:9 window: cover already crops most of it.
  const letter = findBars(frame(160, 90, { top: 12, bottom: 12 }), 160, 90)!;
  const wide = barsZoom(letter, 16 / 9, 2.39);
  expect(wide === null || wide.scale < 1.05).toBe(true);
  // Nothing to take away: no zoom.
  expect(barsZoom(findBars(frame(160, 90, {}), 160, 90)!, 16 / 9, 16 / 9)).toBeNull();
});

test("a dark frame isn't bars", () => {
  expect(findBars(frame(160, 90, {}, 10), 160, 90)).toBeNull();
  expect(findBars(frame(160, 90, { left: 50, right: 50 }), 160, 90)).toBeNull();
});
