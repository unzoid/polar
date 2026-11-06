import { expect, test } from "bun:test";
import { edgeSwipe, onEdgeSwipe } from "../src/lib/platform/edgeSwipe";

test("a swipe in from the left edge is Back", () => {
  const s = edgeSwipe();
  s.start(5, 400, 0);
  s.move(60, 405);
  expect(s.end(120, 410, 300)).toBe(true);
});

test("a short quick flick from the edge is Back too, a short slow one isn't", () => {
  const s = edgeSwipe();
  s.start(10, 400, 0);
  expect(s.end(50, 402, 60)).toBe(true);
  s.start(10, 400, 0);
  expect(s.end(50, 402, 600)).toBe(false);
});

test("a touch away from the edge, a vertical scroll, a second finger or a swipe back left isn't Back", () => {
  const s = edgeSwipe();
  s.start(100, 400, 0);
  expect(s.end(300, 400, 200)).toBe(false);
  s.start(5, 400, 0);
  s.move(20, 300);
  expect(s.end(150, 300, 300)).toBe(false);
  s.start(5, 400, 0, 2);
  expect(s.end(150, 400, 200)).toBe(false);
  s.start(20, 400, 0);
  expect(s.end(0, 400, 50)).toBe(false);
});

test("onEdgeSwipe hears touches until it's turned off", () => {
  const listeners = new Map<string, (e: unknown) => void>();
  const target = {
    addEventListener: (type: string, fn: (e: unknown) => void) => void listeners.set(type, fn),
    removeEventListener: (type: string) => void listeners.delete(type),
  } as unknown as Window;
  let backs = 0;
  const off = onEdgeSwipe(() => backs++, target);
  const touch = (x: number, y: number) => ({ clientX: x, clientY: y });
  listeners.get("touchstart")!({ touches: [touch(4, 300)], timeStamp: 0 });
  listeners.get("touchmove")!({ touches: [touch(80, 302)] });
  listeners.get("touchend")!({ touches: [], changedTouches: [touch(140, 304)], timeStamp: 250 });
  expect(backs).toBe(1);
  off();
  expect(listeners.size).toBe(0);
});
