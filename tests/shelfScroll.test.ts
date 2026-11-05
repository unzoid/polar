import { expect, test } from "bun:test";
import { upNextMove } from "../src/lib/ui/shelfScroll";

const view = { left: 100, width: 1000 };

test("a new list (first show, another season, another layout) jumps so up next is the first card", () => {
  expect(upNextMove({ newList: true, card: { left: 3000, width: 300 }, view })).toBe("jump");
});

test("up next changing on a list already shown doesn't jump the row (re-test 6b)", () => {
  // Coming back from the player: the episode just watched or the next one is usually in view already.
  expect(upNextMove({ newList: false, card: { left: 400, width: 300 }, view })).toBe("none");
  // Out of view: it glides there instead of teleporting.
  expect(upNextMove({ newList: false, card: { left: 1500, width: 300 }, view })).toBe("smooth");
  expect(upNextMove({ newList: false, card: { left: 950, width: 300 }, view })).toBe("smooth");
  expect(upNextMove({ newList: false, card: null, view })).toBe("none");
});
