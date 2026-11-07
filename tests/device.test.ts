import { expect, test } from "bun:test";
import { batterySaver, canEmbedOtherSites, detectIpad, detectOs, detectTvDevice, onMobileData } from "../src/lib/platform/device";

test("detectOs reads the webview's navigator", () => {
  expect(detectOs({ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" })).toBe("windows");
  expect(detectOs({ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" })).toBe("macos");
  expect(detectOs({ platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64)" })).toBe("linux");
  expect(detectOs({ platform: "Linux armv8l", userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)" })).toBe("android");
  expect(detectOs({ platform: "iPhone", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" })).toBe("ios");
  // iPadOS asks for the desktop site: it says Mac, but has a touch screen.
  expect(detectOs({ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 })).toBe("ios");
  expect(detectOs({ userAgent: "" })).toBe("linux");
});

test("detectTvDevice asks Android's polarDevice bridge and never throws", () => {
  expect(detectTvDevice(undefined)).toBe(false);
  expect(detectTvDevice({})).toBe(false);
  expect(detectTvDevice({ polarDevice: { isTv: () => true } })).toBe(true);
  expect(detectTvDevice({ polarDevice: { isTv: () => false } })).toBe(false);
  expect(
    detectTvDevice({
      polarDevice: {
        isTv: () => {
          throw new Error("bridge gone");
        },
      },
    }),
  ).toBe(false);
});

test("detectIpad: the desktop-site iPad, the iPad agent, never an iPhone or a Mac", () => {
  expect(detectIpad({ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 })).toBe(true);
  expect(detectIpad({ platform: "iPad", userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", maxTouchPoints: 5 })).toBe(true);
  expect(detectIpad({ platform: "iPhone", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", maxTouchPoints: 5 })).toBe(false);
  expect(detectIpad({ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" })).toBe(false);
});

test("mobile data and battery saver come from Android's bridge, false without it (#207)", () => {
  expect(onMobileData(undefined)).toBe(false);
  expect(batterySaver({})).toBe(false);
  expect(onMobileData({ polarDevice: { onMobileData: () => true } })).toBe(true);
  expect(batterySaver({ polarDevice: { batterySaver: () => true } })).toBe(true);
  const broken = {
    polarDevice: {
      onMobileData: () => {
        throw new Error("gone");
      },
    },
  };
  expect(onMobileData(broken)).toBe(false);
});

test("other sites' pages play in a frame inside the app everywhere but Android", () => {
  expect(canEmbedOtherSites("android")).toBe(false);
  for (const o of ["windows", "macos", "linux", "ios"] as const) expect(canEmbedOtherSites(o)).toBe(true);
});
