import { expect, test } from "bun:test";
import { mediumOffset, restingDetent } from "../src/lib/ui/detents";

test("the medium detent shows half the viewport of a sheet laid out at its large height", () => {
  expect(mediumOffset(800, 900)).toBe(350);
  // A sheet shorter than half the screen has no lower stop than its own top.
  expect(mediumOffset(300, 900)).toBe(0);
});

test("a throw rests at the nearest detent, or closes past the medium one", () => {
  const medium = 350;
  const height = 800;
  expect(restingDetent(40, medium, height)).toBe("large");
  expect(restingDetent(300, medium, height)).toBe("medium");
  expect(restingDetent(500, medium, height)).toBe("medium");
  expect(restingDetent(620, medium, height)).toBeNull();
  // A flick up from medium lands above the top: large, never past it.
  expect(restingDetent(-400, medium, height)).toBe("large");
});
