import { expect, test } from "bun:test";
import { mpvVolume, sliderAmplitude } from "../src/lib/playback/volume";

const dB = (amplitude: number) => 20 * Math.log10(amplitude);

test("the volume slider sounds even: half way is about −10 dB, not mpv's −18 (test report 1, item 13)", () => {
  expect(sliderAmplitude(0)).toBe(0);
  expect(sliderAmplitude(1)).toBe(1);
  expect(dB(sliderAmplitude(0.5))).toBeCloseTo(-10, 0);
  expect(dB(sliderAmplitude(0.25))).toBeCloseTo(-20, 0);
  // Each tenth of the slider changes the level by less than the one below it: no cliff at the top.
  const steps = Array.from({ length: 9 }, (_, i) => dB(sliderAmplitude((i + 2) / 10)) - dB(sliderAmplitude((i + 1) / 10)));
  for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeLessThan(steps[i - 1]);
});

test("mpv gets the volume whose cube is that amplitude", () => {
  expect(mpvVolume(0)).toBe(0);
  expect(mpvVolume(1)).toBe(100);
  const a = sliderAmplitude(0.5);
  expect(Math.abs((mpvVolume(a) / 100) ** 3 - a)).toBeLessThan(0.002);
  // The old mapping sent the slider straight on: half way was volume 50, −18 dB.
  expect(mpvVolume(a)).toBeGreaterThan(65);
});
