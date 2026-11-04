import { expect, test } from "bun:test";
import { trapTarget } from "../src/lib/layer";

test("Tab wraps only at the edges", () => {
  expect(trapTarget(3, 2, false, true)).toBe(0);
  expect(trapTarget(3, 0, true, true)).toBe(2);
  expect(trapTarget(3, 1, false, true)).toBeNull();
  expect(trapTarget(3, 1, true, true)).toBeNull();
  expect(trapTarget(3, 0, false, true)).toBeNull();
});

test("focus on the layer itself or on nothing goes to the first or last control", () => {
  expect(trapTarget(3, -1, false, true)).toBe(0);
  expect(trapTarget(3, -1, true, true)).toBe(2);
  expect(trapTarget(3, -1, false, false)).toBe(0);
  expect(trapTarget(3, -1, true, false)).toBe(2);
});

test("a layer with no controls keeps focus on itself", () => {
  expect(trapTarget(0, -1, false, true)).toBe(-1);
  expect(trapTarget(0, -1, true, false)).toBe(-1);
});

test("focus outside the layer (a portalled menu) is left alone", () => {
  expect(trapTarget(3, -1, false, false, true)).toBeNull();
  expect(trapTarget(0, -1, true, false, true)).toBeNull();
});
