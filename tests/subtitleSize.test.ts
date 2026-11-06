import { describe, expect, test } from "bun:test";
import { CUE_LINE_HEIGHT, cueFontSize, fontSizeForLine, MPV_SUB_DEFAULTS, mpvSubtitleBox } from "../src/components/player/subtitleSize";

// A 1920×1080 window (mpv's pixels) shown at 960×540 CSS pixels.
const WIDE = { w: 1920, h: 1080, mt: 0, mb: 0, ml: 0, mr: 0 };
// A 2.39:1 picture in the same window: black bars of 138 above and below.
const SCOPE = { ...WIDE, mt: 138, mb: 138 };

describe("mpvSubtitleBox", () => {
  test("16:9: 42 on the 720-line canvas is 63 window pixels, 22 of margin under the line's bottom", () => {
    const box = mpvSubtitleBox(WIDE, MPV_SUB_DEFAULTS, 0.5);
    expect(box.line).toBeCloseTo(31.5, 6);
    expect(box.border).toBeCloseTo(1.2, 6);
    expect(box.shadow).toBeCloseTo(0.75, 6);
    // MarginV: 22 × 288/720 = 8.8, stored as 8 script units, 3.75 px each.
    expect(box.bottom).toBeCloseTo(15, 6);
    // MarginL: 10 units × 512/384 → 13, on a 512-wide script over 1920 px.
    expect(box.side).toBeCloseTo((13 * 1920) / 512 / 2, 6);
  });

  test("2.39:1: the same size (it follows the window), the margin rescaled with the font", () => {
    const box = mpvSubtitleBox(SCOPE, MPV_SUB_DEFAULTS, 0.5);
    expect(box.line).toBeCloseTo(31.5, 6);
    expect(box.border).toBeCloseTo(1.2, 6);
    // MarginV 8 × 1080/804 → 11 units of 804/288 px, placed in the window's bottom bar.
    expect(box.bottom).toBeCloseTo((1080 - ((288 - 11) * 804) / 288 - 276) / 2, 6);
  });

  test("crop or Fill (the picture overflows: no margins) and a smaller window scale together", () => {
    const small = mpvSubtitleBox({ w: 1280, h: 720, mt: 0, mb: 0, ml: 0, mr: 0 }, MPV_SUB_DEFAULTS, 1);
    expect(small.line).toBeCloseTo(42, 6);
    expect(small.bottom).toBeCloseTo(8 * 2.5, 6);
  });

  test("sub-scale grows the font, outline, shadow and margin; sub-pos lifts the line", () => {
    const box = mpvSubtitleBox(WIDE, { ...MPV_SUB_DEFAULTS, scale: 1.5, pos: 90 }, 1);
    expect(box.line).toBeCloseTo(94.5, 6);
    expect(box.border).toBeCloseTo(3.6, 6);
    expect(box.shadow).toBeCloseTo(2.25, 6);
    // MarginV 8 × 1.5 = 12 units: bottom edge at 1035, then 10% of the way to the top.
    expect(box.bottom).toBeCloseTo(1080 - 1035 * 0.9, 6);
  });

  test("sub-scale-by-window=no keeps sub-font-size in window pixels", () => {
    expect(mpvSubtitleBox(WIDE, { ...MPV_SUB_DEFAULTS, scaleByWindow: false }, 1).line).toBeCloseTo(42, 6);
  });

  test("sub-use-margins=no keeps the line on the picture", () => {
    const box = mpvSubtitleBox(SCOPE, { ...MPV_SUB_DEFAULTS, useMargins: false }, 1);
    expect(box.line).toBeCloseTo(63, 6);
    expect(box.bottom).toBeCloseTo(1080 - (((288 - 11) * 804) / 288 + 138), 6);
  });

  test("sub-scale-with-window=no follows the picture's height", () => {
    expect(mpvSubtitleBox(SCOPE, { ...MPV_SUB_DEFAULTS, scaleWithWindow: false }, 1).line).toBeCloseTo((42 * 804) / 720, 6);
  });
});

test("fontSizeForLine: libass sizes by ascent + descent, CSS by the em", () => {
  expect(fontSizeForLine(63, 1.33)).toBeCloseTo(63 / 1.33, 6);
  expect(fontSizeForLine(63, 0)).toBe(63);
});

test("cueFontSize repeats ::cue's clamp(1.25rem, 2.4vw, 2.25rem) × scale", () => {
  expect(cueFontSize(400, 16, 1)).toBe(20);
  expect(cueFontSize(1200, 16, 1)).toBeCloseTo(28.8, 6);
  expect(cueFontSize(3000, 16, 1.5)).toBe(54);
  expect(CUE_LINE_HEIGHT).toBe(1.25);
});
