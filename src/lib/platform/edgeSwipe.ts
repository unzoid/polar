/**
 * iOS's Back: a finger swiping in from the screen's left edge. iOS has no Back button, so this is how a
 * pushed page, the player or an open sheet is left there (back.ts). Fed touch points, it answers whether the
 * touch was that swipe; a touch that starts away from the edge, turns into a vertical scroll or uses a
 * second finger isn't.
 */

/** How close to the left edge the touch starts (CSS px). */
export const EDGE_PX = 24;
/** How far right it goes to count, unless it's a flick. */
export const SWIPE_PX = 80;
/** A flick: shorter, but fast (px/ms over at least FLICK_MIN_PX). */
export const FLICK_SPEED = 0.5;
export const FLICK_MIN_PX = 30;

export type EdgeSwipe = {
  start(x: number, y: number, time: number, fingers?: number): void;
  move(x: number, y: number): void;
  /** True when the touch that ends here was the swipe. */
  end(x: number, y: number, time: number): boolean;
  cancel(): void;
};

export function edgeSwipe(): EdgeSwipe {
  let from: { x: number; y: number; time: number } | null = null;
  // More vertical than horizontal past a little slack: a scroll, not Back.
  const vertical = (x: number, y: number) => !!from && Math.abs(y - from.y) > Math.max(FLICK_MIN_PX, x - from.x);
  return {
    start(x, y, time, fingers = 1) {
      from = fingers === 1 && x <= EDGE_PX ? { x, y, time } : null;
    },
    move(x, y) {
      if (vertical(x, y)) from = null;
    },
    end(x, y, time) {
      const s = from;
      const turned = vertical(x, y);
      from = null;
      if (!s || turned) return false;
      const dx = x - s.x;
      return dx >= SWIPE_PX || (dx >= FLICK_MIN_PX && dx / Math.max(1, time - s.time) >= FLICK_SPEED);
    },
    cancel() {
      from = null;
    },
  };
}

/** Hear the swipe on `target` until the returned function is called. */
export function onEdgeSwipe(handler: () => void, target: Pick<Window, "addEventListener" | "removeEventListener"> = window): () => void {
  const swipe = edgeSwipe();
  const opts = { passive: true, capture: true };
  const start = (e: TouchEvent) => {
    const t = e.touches[0];
    if (t) swipe.start(t.clientX, t.clientY, e.timeStamp, e.touches.length);
  };
  const move = (e: TouchEvent) => {
    const t = e.touches[0];
    if (e.touches.length > 1) swipe.cancel();
    else if (t) swipe.move(t.clientX, t.clientY);
  };
  const end = (e: TouchEvent) => {
    const t = e.changedTouches[0];
    if (t && swipe.end(t.clientX, t.clientY, e.timeStamp)) handler();
  };
  const cancel = () => swipe.cancel();
  const listeners = [
    ["touchstart", start],
    ["touchmove", move],
    ["touchend", end],
    ["touchcancel", cancel],
  ] as const;
  for (const [type, fn] of listeners) target.addEventListener(type, fn as EventListener, opts);
  return () => {
    for (const [type, fn] of listeners) target.removeEventListener(type, fn as EventListener, opts);
  };
}
