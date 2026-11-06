import { expect, test } from "bun:test";
import { HOLD_MS, onLongPress, SLOP_PX, type Held } from "../src/lib/platform/longPress";

/** A page to touch, and a clock that only moves when told to. */
function setup(used = true) {
  const page = new EventTarget();
  let due: { fn: () => void; at: number } | null = null;
  let now = 0;
  const clock = { set: (fn: () => void, ms: number) => (due = { fn, at: now + ms }), clear: () => (due = null) };
  const tick = (ms: number) => {
    now += ms;
    if (due && due.at <= now) {
      const { fn } = due;
      due = null;
      fn();
    }
  };
  const held: Held[] = [];
  const off = onLongPress((h) => (held.push(h), used), page as unknown as Window, clock);
  const touch = (type: string, points: { x: number; y: number }[]) =>
    page.dispatchEvent(Object.assign(new Event(type), { touches: points.map((p) => ({ clientX: p.x, clientY: p.y })) }));
  const click = () => {
    const e = new Event("click", { cancelable: true });
    page.dispatchEvent(e);
    return e.defaultPrevented;
  };
  return { held, tick, touch, click, off };
}

test("a finger held still is a long press at where it is, and the click its lifting makes is swallowed", () => {
  const p = setup();
  p.touch("touchstart", [{ x: 40, y: 50 }]);
  p.tick(HOLD_MS - 1);
  expect(p.held).toEqual([]);
  p.touch("touchmove", [{ x: 43, y: 52 }]);
  p.tick(1);
  expect(p.held.map(({ x, y }) => [x, y])).toEqual([[40, 50]]);
  p.touch("touchend", []);
  expect(p.click()).toBe(true);
  // Only that one.
  expect(p.click()).toBe(false);
});

test("a tap, a scroll or a second finger isn't a long press, and their clicks go through", () => {
  const p = setup();
  p.touch("touchstart", [{ x: 40, y: 50 }]);
  p.tick(100);
  p.touch("touchend", []);
  p.tick(HOLD_MS);
  expect(p.click()).toBe(false);

  p.touch("touchstart", [{ x: 40, y: 50 }]);
  p.touch("touchmove", [{ x: 40, y: 50 + SLOP_PX + 1 }]);
  p.tick(HOLD_MS);

  p.touch("touchstart", [
    { x: 40, y: 50 },
    { x: 90, y: 50 },
  ]);
  p.tick(HOLD_MS);

  p.touch("touchstart", [{ x: 40, y: 50 }]);
  p.touch("touchmove", [
    { x: 40, y: 50 },
    { x: 90, y: 50 },
  ]);
  p.tick(HOLD_MS);
  expect(p.held).toEqual([]);
});

test("a press nothing used keeps its click, and after the returned function nothing is heard", () => {
  const p = setup(false);
  p.touch("touchstart", [{ x: 40, y: 50 }]);
  p.tick(HOLD_MS);
  expect(p.held.length).toBe(1);
  expect(p.click()).toBe(false);
  p.off();
  p.touch("touchstart", [{ x: 40, y: 50 }]);
  p.tick(HOLD_MS);
  expect(p.held.length).toBe(1);
});
