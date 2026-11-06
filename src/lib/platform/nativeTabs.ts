import { call, inShell, on, type Unlisten } from "./bridge";
import { os } from "./device";

/**
 * iOS's own tab bar for the app's sections (src-tauri/src/ios/tabs.m, a UITabBarController around the web view):
 * on iOS 26 and later it's the floating Liquid Glass bar, on older iOS the classic one, and on an iPad the tab bar
 * that turns into a sidebar. The web app says which tabs there are, which one is current and whether the bar shows;
 * a tap on a tab comes back through onNativeTab. Android and the desktop draw their own tabs (NavBar).
 */
export const nativeTabsAvailable = os === "ios" && inShell;

/** One tab: `id` names it both ways, `icon` is an SF Symbol name (its ".fill" form marks the current tab where it exists). */
export type NativeTab = { id: string; title: string; icon: string };

export type NativeTabsState = {
  tabs: NativeTab[];
  /** The current tab's id: none while a page outside the tabs is on top. */
  selected: string | null;
  /** Hidden while the player, Settings or a sheet is open: they cover the whole screen, as iOS's own sheets cover its tab bar. */
  hidden: boolean;
};

/** Show the tabs as given; the first call puts the tab bar around the web view. */
export function setNativeTabs(state: NativeTabsState): Promise<void> {
  return call("native_tabs", { tabs: state });
}

/** Hear the tab the user picked (its id) until the returned function is called. */
export function onNativeTab(handler: (id: string) => void): Promise<Unlisten> {
  return on<string>("native://tab", handler);
}
