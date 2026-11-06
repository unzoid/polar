import { expect, test } from "bun:test";
import { pinchDirection } from "../src/components/player/usePinch";

test("a pinch counts once the fingers spread or close by a fifth (#176)", () => {
  expect(pinchDirection(100, 110)).toBeUndefined();
  expect(pinchDirection(100, 90)).toBeUndefined();
  expect(pinchDirection(100, 120)).toBe("out");
  expect(pinchDirection(100, 80)).toBe("in");
  expect(pinchDirection(0, 50)).toBeUndefined();
});
