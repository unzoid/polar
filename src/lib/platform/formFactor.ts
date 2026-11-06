import { os as deviceOs, isIpad, type Os } from "./device";

/**
 * What kind of device the app is laid out for (docs/ARCHITECTURE.md §4). The screens are the same on every one;
 * this picks the shell around them and the size of what you touch:
 *  - desktop: a window, a pointer and a keyboard; narrow windows tighten by width (CSS breakpoints).
 *  - tablet:  the desktop layout with touch-sized targets.
 *  - phone:   the tabs move to a bar at the bottom, within thumb reach, and the content keeps clear of the
 *             notch and the home indicator.
 * An iPad is a tablet in any window, Split View and Stage Manager's narrow ones too: its windows keep the
 * tablet's layout as iPadOS's own apps keep theirs.
 * TV is a mode, not a form factor: it has its own shell (src/tv), switched on by the user or, on a TV device, at start.
 */
export type FormFactor = "desktop" | "tablet" | "phone";

/** The screen as the webview sees it, in CSS pixels. */
export type ScreenInfo = { width: number; height: number; coarse: boolean; fine: boolean };

/** Shortest side below which a touch device is a phone: Android's 600dp tablet line. */
export const PHONE_MAX = 600;

/** A phone or tablet system turned sideways stays what it is, so the shortest side decides (an iPad: always a tablet). */
export function formFactorOf(os: Os, { width, height, coarse, fine }: ScreenInfo, ipad = false): FormFactor {
  if (os === "ios" && ipad) return "tablet";
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

/**
 * A phone or tablet window narrower than a phone held sideways: a phone upright, or an iPad's Slide Over and
 * narrow Split View windows. The player's controls take their compact arrangement there (player.css).
 */
export function isCompactOf(form: FormFactor, { width }: ScreenInfo): boolean {
  return form !== "desktop" && width < PHONE_MAX;
}

function measure(s: ScreenInfo) {
  const form = formFactorOf(deviceOs, s, isIpad);
  return { form, touch: isTouchOf(deviceOs, s), compact: isCompactOf(form, s) };
}

let current = measure(read());
const listeners = new Set<() => void>();

/** The form factor now, whether the screen is touched, and whether the window is compact. */
export const formFactor = () => current;

/** Called when one changes (a window resized, a tablet's keyboard cover attached); returns the unsubscribe. */
export function onFormFactor(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function update() {
  const next = measure(read());
  if (next.form === current.form && next.touch === current.touch && next.compact === current.compact) return;
  current = next;
  listeners.forEach((l) => l());
}

if (typeof window !== "undefined") {
  window.addEventListener("resize", update);
  for (const q of ["(any-pointer: coarse)", "(any-pointer: fine)"]) matchMedia(q).addEventListener?.("change", update);
}
