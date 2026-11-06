import { useRef } from "react";

/** How far two fingers must spread (or close) from where they started before it counts: 20%. */
const THRESHOLD = 1.2;

/** A pinch's direction from the distance between two fingers at its start and now; undefined while too small. */
export function pinchDirection(start: number, now: number): "out" | "in" | undefined {
  if (start <= 0) return undefined;
  if (now / start >= THRESHOLD) return "out";
  if (start / now >= THRESHOLD) return "in";
  return undefined;
}

/**
 * Pointer handlers that report a two-finger pinch on an element once per gesture (#176): out when the
 * fingers spread, in when they close. The element needs `touch-action: none`, so the web view never
 * scales the page instead.
 */
export function usePinch(onPinch: (direction: "out" | "in") => void) {
  const points = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<number | undefined>(undefined);
  const done = useRef(false);
  const spread = () => {
    const [a, b] = [...points.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const end = (e: React.PointerEvent) => {
    points.current.delete(e.pointerId);
    if (points.current.size < 2) start.current = undefined;
    if (points.current.size === 0) done.current = false;
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") return;
      points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (points.current.size === 2) start.current = spread();
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!points.current.has(e.pointerId)) return;
      points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (start.current === undefined || done.current) return;
      const direction = pinchDirection(start.current, spread());
      if (!direction) return;
      done.current = true;
      onPinch(direction);
    },
    onPointerUp: end,
    onPointerCancel: end,
  };
}
