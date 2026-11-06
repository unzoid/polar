import type { NativeTabsState } from "./platform/nativeTabs";
import { rootTab, type Entry, type TabRoute } from "./router";

/** The app's sections, as NavBar lists them and iOS's tab bar shows them (components/NativeTabs.tsx). */
export type NavLink = { route: TabRoute; label: string };

/** Each section's SF Symbol. */
const ICONS: Record<string, string> = {
  home: "house",
  "discover:series": "tv",
  "discover:movie": "film",
  anime: "sparkles",
  library: "books.vertical",
  calendar: "calendar",
};

/** A section's id on both sides of the bridge: Movies and Series are both Discover, so the type tells them apart. */
export function tabId(route: TabRoute): string {
  return route.name === "discover" ? `discover:${route.type}` : route.name;
}

/**
 * What iOS's tab bar shows for these sections: the current one is the stack's root (a shelf's heading opens Movies
 * at a catalog, still Movies), none when that's not a section (search); hidden over the player and over anything
 * that covers the screen (`covered`).
 */
export function nativeTabsState(links: NavLink[], stack: Entry[], covered: boolean): NativeTabsState {
  const tabs = links.map((l) => ({ id: tabId(l.route), title: l.label, icon: ICONS[tabId(l.route)] ?? "square" }));
  const root = tabId(rootTab(stack));
  const playing = stack[stack.length - 1].route.name === "player";
  return { tabs, selected: tabs.some((t) => t.id === root) ? root : null, hidden: playing || covered };
}

/** The section a picked tab opens. */
export function tabRoute(links: NavLink[], id: string): TabRoute | undefined {
  return links.find((l) => tabId(l.route) === id)?.route;
}
