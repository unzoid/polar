import { expect, test } from "bun:test";
import { bakedFilter } from "../src/components/AmbientWash";

test("the wash's blur is drawn once into the small canvas, scaled to its pixels: no full-screen blur per frame (#36)", () => {
  // 60 CSS px of blur on a canvas shown 1920 px wide but 160 px across is 5 of its pixels.
  expect(bakedFilter("blur(60px) saturate(1.5) brightness(0.65)", 1920, 160)).toBe("blur(5px) saturate(1.5) brightness(0.65)");
  expect(bakedFilter(" blur(40px) saturate(1.5) brightness(0.75) ", 1280, 160)).toBe("blur(5px) saturate(1.5) brightness(0.75)");
  expect(bakedFilter("saturate(1.5)", 1920, 160)).toBe("saturate(1.5)");
});

test("nothing to bake when the canvas isn't laid out or there's no filter", () => {
  expect(bakedFilter("blur(60px)", 0, 160)).toBeNull();
  expect(bakedFilter("", 1920, 160)).toBeNull();
  expect(bakedFilter("none", 1920, 160)).toBeNull();
});
