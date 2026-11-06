import { exit, onBackButtonPress } from "@tauri-apps/api/app";
import { inShell, type Unlisten } from "./bridge";
import { os } from "./device";

/**
 * The system's Back: Android's back button and back gesture (a TV remote's Back too). Elsewhere the
 * keyboard's Escape is Back and nothing here runs. While a handler is registered the system no longer
 * goes back or closes the app by itself: the handler decides, and calls `leaveApp` at the root.
 */
export const hasSystemBack = inShell && os === "android";

/** Hear the system's Back until the returned function is called; a no-op where there is none. */
export async function onSystemBack(handler: () => void): Promise<Unlisten> {
  if (!hasSystemBack) return () => {};
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
