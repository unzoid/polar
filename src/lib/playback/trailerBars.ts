/**
 * Black bars inside a trailer's picture (test report 1, item 16): IMDb trailers are often
 * letterboxed or pillarboxed inside a 16:9 frame, and `object-fit: cover` can't take those away.
 * Pure: the frame comes in as RGBA pixels (a small canvas copy), the answer is how to zoom.
 */

export interface Bars {
  /** Fractions of the frame's height (top, bottom) and width (left, right) that are bar. */
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Brighter than this (0–255) isn't bar. */
const DARK = 24;
/** A line is bar when this share of it is dark (a logo's antialiasing, noise). */
const MOSTLY = 0.98;

/**
 * The bars around a frame, or null when the frame says nothing (mostly dark: a fade, a black title
 * card), so a dark shot never passes for bars.
 */
export function findBars(px: Uint8ClampedArray, w: number, h: number): Bars | null {
  const luma = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  };
  const darkRow = (y: number) => {
    let n = 0;
    for (let x = 0; x < w; x++) if (luma(x, y) < DARK) n++;
    return n >= w * MOSTLY;
  };
  const darkCol = (x: number) => {
    let n = 0;
    for (let y = 0; y < h; y++) if (luma(x, y) < DARK) n++;
    return n >= h * MOSTLY;
  };
  let top = 0;
  while (top < h && darkRow(top)) top++;
  let bottom = 0;
  while (bottom < h - top && darkRow(h - 1 - bottom)) bottom++;
  let left = 0;
  while (left < w && darkCol(left)) left++;
  let right = 0;
  while (right < w - left && darkCol(w - 1 - right)) right++;
  if ((top + bottom) / h > 0.45 || (left + right) / w > 0.45) return null;
  return { top: top / h, bottom: bottom / h, left: left / w, right: right / w };
}

/**
 * How to show a video of aspect `videoAspect` in a box of aspect `boxAspect` (object-fit: cover) so
 * its picture inside `bars` fills the box: a scale around the centre and a shift (fractions of the
 * box), or none when the bars are already off screen.
 */
export function barsZoom(bars: Bars, videoAspect: number, boxAspect: number): { scale: number; x: number; y: number } | null {
  // The drawn video's size in box units (cover: one side fits, the other overflows).
  const dw = boxAspect > videoAspect ? 1 : videoAspect / boxAspect;
  const dh = boxAspect > videoAspect ? boxAspect / videoAspect : 1;
  const pw = (1 - bars.left - bars.right) * dw;
  const ph = (1 - bars.top - bars.bottom) * dh;
  // A hair more, so a bar's soft edge never shows.
  const scale = Math.max(1, 1 / pw, 1 / ph) * (pw < 1 || ph < 1 ? 1.01 : 1);
  if (scale <= 1.001) return null;
  // Keep the picture centred when the bars aren't even.
  const x = ((bars.right - bars.left) / 2) * dw * scale;
  const y = ((bars.bottom - bars.top) / 2) * dh * scale;
  return { scale, x, y };
}

/** A link as a path on the shell's `trailer` protocol: hex of its UTF-8 (polar_player::passthrough::to_hex). */
export const trailerPath = (link: string) => [...new TextEncoder().encode(link)].map((b) => b.toString(16).padStart(2, "0")).join("");
