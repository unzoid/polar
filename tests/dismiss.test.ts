import { expect, test } from "bun:test";
import { dismissDepth, dismissTop, handleDismissKey, onDismissed, pushDismiss } from "../src/lib/ui/dismiss";

const key = (k: string, init: { defaultPrevented?: boolean; isComposing?: boolean } = {}) => {
  const e = { key: k, defaultPrevented: !!init.defaultPrevented, isComposing: !!init.isComposing, stopped: false };
  return Object.assign(e, {
    preventDefault: () => void (e.defaultPrevented = true),
    stopPropagation: () => void (e.stopped = true),
  });
};

test("Escape closes only the topmost layer, then the one under it", () => {
  const closed: string[] = [];
  const offA = pushDismiss(() => closed.push("a"));
  const offB = pushDismiss(() => closed.push("b"));
  const e = key("Escape");
  expect(handleDismissKey(e)).toBe(true);
  expect(closed).toEqual(["b"]);
  expect(e.defaultPrevented && e.stopped).toBe(true);
  offB();
  handleDismissKey(key("Escape"));
  expect(closed).toEqual(["b", "a"]);
  offA();
  expect(dismissDepth()).toBe(0);
});

test("handled, composing and other keys pass through; nothing open passes through", () => {
  let n = 0;
  const off = pushDismiss(() => n++);
  expect(handleDismissKey(key("Escape", { defaultPrevented: true }))).toBe(false);
  expect(handleDismissKey(key("Escape", { isComposing: true }))).toBe(false);
  expect(handleDismissKey(key("Enter"))).toBe(false);
  expect(n).toBe(0);
  off();
  const e = key("Escape");
  expect(handleDismissKey(e)).toBe(false);
  expect(e.defaultPrevented || e.stopped).toBe(false);
});

test("removing a lower layer first keeps the top one on top", () => {
  const closed: string[] = [];
  const offA = pushDismiss(() => closed.push("a"));
  const offB = pushDismiss(() => closed.push("b"));
  offA();
  offA();
  handleDismissKey(key("Escape"));
  expect(closed).toEqual(["b"]);
  offB();
  expect(dismissDepth()).toBe(0);
});

test("Back without Escape closes the top layer and tells the listeners; nothing open, nothing told", () => {
  const closed: string[] = [];
  let told = 0;
  const offTold = onDismissed(() => told++);
  const offA = pushDismiss(() => closed.push("a"));
  const offB = pushDismiss(() => closed.push("b"));
  expect(dismissTop()).toBe(true);
  expect(closed).toEqual(["b"]);
  offB();
  handleDismissKey(key("Escape"));
  expect(closed).toEqual(["b", "a"]);
  expect(told).toBe(2);
  offA();
  expect(dismissTop()).toBe(false);
  handleDismissKey(key("Escape"));
  expect(told).toBe(2);
  offTold();
});
