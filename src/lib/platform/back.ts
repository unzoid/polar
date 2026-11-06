import { exit, onBackButtonPress } from "@tauri-apps/api/app";
import { inShell, type Unlisten } from "./bridge";
import { os } from "./device";
import { onEdgeSwipe } from "./edgeSwipe";

/**
 * The system's Back: Android's back button and back gesture (a TV remote's Back too), and on iOS, which
 * has neither, a swipe in from the left edge (edgeSwipe.ts). Elsewhere the keyboard's Escape is Back and
 * nothing here runs. While an Android handler is registered the system no longer goes back or closes the
 * app by itself: the handler decides, and calls `leaveApp` at the root.
 */
export const systemBack: "button" | "swipe" | null = !inShell ? null : os === "android" ? "button" : os === "ios" ? "swipe" : null;

/** Hear the system's Back until the returned function is called; a no-op where there is none. */
export async function onSystemBack(handler: () => void): Promise<Unlisten> {
  if (systemBack === "swipe") return onEdgeSwipe(handler);
  if (systemBack !== "button") return () => {};
  const listener = await onBackButtonPress(() => handler());
  return () => void listener.unregister();
}

type LeaveBridge = { polarDevice?: { leave?: () => void } };

/**
 * Leave the app the way Back at the root does on Android: the activity goes to the background with the
 * system's transition (`polarDevice.leave` from gen/android MainActivity.kt, what Android 12 and later
 * do on their own), and the app is there as it was when it's opened again. Ending the process instead
 * (`exit`, still the way where the bridge is missing) ran its exit handlers while the web view's render
 * threads were still drawing, and crashed it.
 */
export function leaveApp(scope: LeaveBridge = globalThis as LeaveBridge, quit: () => Promise<void> = () => exit(0)): Promise<void> {
  const device = scope.polarDevice;
  if (typeof device?.leave === "function") {
    device.leave();
    return Promise.resolve();
  }
  return quit();
}

type ImmersiveBridge = { polarDevice?: { immersive?: (on: boolean) => void } };

/**
 * Hide Android's status and navigation bars while the player is open, and bring them back after (#178).
 * A swipe from the edge shows them for a moment, as in other video apps (`polarDevice.immersive` from
 * gen/android MainActivity.kt). Elsewhere there's no bridge and it does nothing.
 */
export function setImmersive(on: boolean, scope: ImmersiveBridge = globalThis as ImmersiveBridge): void {
  try {
    scope.polarDevice?.immersive?.(on);
  } catch {
    // An older shell without the call: the bars stay, as before.
  }
}
