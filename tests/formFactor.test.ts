import { expect, test } from "bun:test";
import { formFactorOf, isTouchOf, PHONE_MAX } from "../src/lib/platform/formFactor";

const mouse = { coarse: false, fine: true };
const finger = { coarse: true, fine: false };
const both = { coarse: true, fine: true };

test("phones and tablets are told apart by their shortest side, so turning one sideways changes nothing", () => {
  expect(formFactorOf("android", { width: 412, height: 915, ...finger })).toBe("phone");
  expect(formFactorOf("android", { width: 915, height: 412, ...finger })).toBe("phone");
  expect(formFactorOf("ios", { width: 390, height: 844, ...finger })).toBe("phone");
  expect(formFactorOf("ios", { width: 820, height: 1180, ...finger })).toBe("tablet");
  expect(formFactorOf("ios", { width: 1180, height: 820, ...finger })).toBe("tablet");
  expect(formFactorOf("android", { width: PHONE_MAX, height: 960, ...finger })).toBe("tablet");
  expect(formFactorOf("android", { width: PHONE_MAX - 1, height: 960, ...finger })).toBe("phone");
});

test("a desktop system is a desktop at any window size, unless only fingers point", () => {
  expect(formFactorOf("windows", { width: 400, height: 700, ...mouse })).toBe("desktop");
  expect(formFactorOf("macos", { width: 1440, height: 900, ...mouse })).toBe("desktop");
  // A touch-screen laptop still has its trackpad.
  expect(formFactorOf("windows", { width: 1280, height: 800, ...both })).toBe("desktop");
  // A Windows tablet with the keyboard cover off.
  expect(formFactorOf("windows", { width: 1280, height: 800, ...finger })).toBe("tablet");
});

test("touch: phones and tablets always, desktops only without a fine pointer", () => {
  expect(isTouchOf("android", { width: 412, height: 915, ...both })).toBe(true);
  expect(isTouchOf("ios", { width: 820, height: 1180, ...finger })).toBe(true);
  expect(isTouchOf("linux", { width: 1280, height: 800, ...mouse })).toBe(false);
  expect(isTouchOf("windows", { width: 1280, height: 800, ...both })).toBe(false);
  expect(isTouchOf("windows", { width: 1280, height: 800, ...finger })).toBe(true);
});
