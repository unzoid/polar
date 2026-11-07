/**
 * The resting heights of an iOS bottom sheet (Sheet.tsx), as iOS's own sheets have them: half the screen
 * (medium) and nearly all of it (large). The sheet is always laid out at its large height and moved down
 * to show its medium part, so a detent is an offset from the top: 0 for large, `medium` for medium.
 */
export type Detent = "medium" | "large";

/** How far down the sheet sits at the medium detent: what's left of `height` once half the viewport shows. */
export function mediumOffset(height: number, viewport: number): number {
  return Math.max(0, Math.round(height - viewport / 2));
}

/**
 * Where a drag lets go: the detent nearest to where the throw lands (`landing`, an offset from the top,
 * momentum included), or `null` to close when that's nearer the bottom edge than the medium detent.
 */
export function restingDetent(landing: number, medium: number, height: number): Detent | null {
  const stops: [number, Detent | null][] = [
    [0, "large"],
    [medium, "medium"],
    [height, null],
  ];
  let best = stops[0];
  for (const stop of stops) if (Math.abs(landing - stop[0]) < Math.abs(landing - best[0])) best = stop;
  return best[1];
}
