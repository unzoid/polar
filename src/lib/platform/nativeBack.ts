import { call, inShell, on, type Unlisten } from "./bridge";
import { os } from "./device";

/**
 * iOS's own back button (src-tauri/src/ios/back.m): a system button laid over the web app's Back where it stands,
 * Liquid Glass on iOS 26 and later, with the pages behind it in its long-press menu. The web app says where its Back
 * is, whether it shows and what's behind; a tap comes back through onNativeBack as 1, a page picked from the menu as
 * how many steps back it is. Android and the desktop show the web app's own Back.
 */
export const nativeBackAvailable = os === "ios" && inShell;

export type NativeBackState = {
  shown: boolean;
  /** The web app's Back, in CSS pixels of the viewport. */
  rect: { x: number; y: number; width: number; height: number } | null;
  /** The pages behind, nearest first. */
  history: string[];
};

export function setNativeBack(state: NativeBackState): Promise<void> {
  return call("native_back", { back: state });
}

/** Hear the button (how many steps back) until the returned function is called. */
export function onNativeBack(handler: (steps: number) => void): Promise<Unlisten> {
  return on<number>("native://back", handler);
}
