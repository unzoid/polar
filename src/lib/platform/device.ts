/**
 * Which operating system the app runs on, for the few places it differs:
 * macOS keeps its own traffic-light window buttons (Windows and Linux draw
 * ours), shortcuts use ⌘ there instead of Ctrl, and fonts and font weights
 * follow each system's own.
 */
export type Os = "windows" | "macos" | "linux" | "android" | "ios";

type Agent = { platform?: string; userAgent: string; maxTouchPoints?: number };

/** Read from the webview's navigator; iPads ask for the desktop site and say "Mac", touch gives them away. */
export function detectOs({ platform = "", userAgent, maxTouchPoints = 0 }: Agent): Os {
  if (/Android/i.test(userAgent)) return "android";
  if (/iPhone|iPad|iPod|AppleTV/i.test(userAgent)) return "ios";
  if (/Mac/i.test(platform || userAgent)) return maxTouchPoints > 1 ? "ios" : "macos";
  if (/Win/i.test(platform || userAgent)) return "windows";
  return "linux";
}

export const os: Os = typeof navigator === "undefined" ? "linux" : detectOs(navigator);

/** The name people know it by, for bug reports. */
export const osName = { windows: "Windows", macos: "macOS", linux: "Linux", android: "Android", ios: "iOS" }[os];

export const isMac = os === "macos";

/** A desktop system: windows, a pointer and a keyboard first, the app updates itself. */
export const isDesktop = os === "windows" || os === "macos" || os === "linux";

type TvBridge = { polarDevice?: { isTv?: () => boolean } };

/** Whether the device itself is a TV: Android's activity says so through `polarDevice` (gen/android MainActivity.kt) before the page loads. */
export function detectTvDevice(scope: TvBridge | undefined): boolean {
  try {
    return scope?.polarDevice?.isTv?.() === true;
  } catch {
    return false;
  }
}

/** A TV set or box (Android TV, Google TV, Fire TV): TV mode is on at start there. */
export const isTvDevice = detectTvDevice(typeof window === "undefined" ? undefined : (window as TvBridge));

/** The shortcut modifier, as stored in bindings ("Ctrl+k" / "Meta+k"). */
export const MOD = isMac ? "Meta" : "Ctrl";

/** ...and as people read it. */
export const MOD_LABEL = isMac ? "⌘" : "Ctrl";
