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

/** Close the app the way Back at the root does on Android (the activity finishes with the system transition). */
export const leaveApp = () => exit(0);
