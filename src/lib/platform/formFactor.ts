import { os as deviceOs, type Os } from "./device";

/**
 * What kind of device the app is laid out for (docs/ARCHITECTURE.md §4). The screens are the same on every one;
 * this picks the shell around them and the size of what you touch:
 *  - desktop: a window, a pointer and a keyboard; narrow windows tighten by width (CSS breakpoints).
 *  - tablet:  the desktop layout with touch-sized targets.
 *  - phone:   the tabs move to a bar at the bottom, within thumb reach, and the content keeps clear of the
 *             notch and the home indicator.
 * TV is a mode, not a form factor: it has its own shell (src/tv) and is switched on by the user.
 */
export type FormFactor = "desktop" | "tablet" | "phone";

/** The screen as the webview sees it, in CSS pixels. */
export type ScreenInfo = { width: number; height: number; coarse: boolean; fine: boolean };

/** Shortest side below which a touch device is a phone: Android's 600dp tablet line. */
export const PHONE_MAX = 600;

/** A phone or tablet system turned sideways stays what it is, so the shortest side decides. */
export function formFactorOf(os: Os, { width, height, coarse, fine }: ScreenInfo): FormFactor {
  if (os === "android" || os === "ios") return Math.min(width, height) < PHONE_MAX ? "phone" : "tablet";
  // A Windows or Linux tablet with no mouse or trackpad attached.
  return coarse && !fine ? "tablet" : "desktop";
}

/** Fingers, not a pointer: targets grow to 44px and nothing waits for a hover. */
export function isTouchOf(os: Os, { coarse, fine }: ScreenInfo): boolean {
  return os === "android" || os === "ios" || (coarse && !fine);
}

const media = (q: string) => typeof matchMedia !== "undefined" && matchMedia(q).matches;

function read(): ScreenInfo {
  if (typeof window === "undefined") return { width: 1280, height: 800, coarse: false, fine: true };
  return { width: window.innerWidth, height: window.innerHeight, coarse: media("(any-pointer: coarse)"), fine: media("(any-pointer: fine)") };
}

let current = { form: formFactorOf(deviceOs, read()), touch: isTouchOf(deviceOs, read()) };
const listeners = new Set<() => void>();

/** The form factor now, and whether the screen is touched. */
export const formFactor = () => current;

/** Called when either changes (a window resized, a tablet's keyboard cover attached); returns the unsubscribe. */
export function onFormFactor(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function update() {
  const s = read();
  const next = { form: formFactorOf(deviceOs, s), touch: isTouchOf(deviceOs, s) };
  if (next.form === current.form && next.touch === current.touch) return;
  current = next;
  listeners.forEach((l) => l());
}

if (typeof window !== "undefined") {
  window.addEventListener("resize", update);
  for (const q of ["(any-pointer: coarse)", "(any-pointer: fine)"]) matchMedia(q).addEventListener?.("change", update);
}
