import type { NativeTabsState } from "./platform/nativeTabs";
import { rootTab, type Entry, type Route, type TabRoute } from "./router";

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

/** The search tab, after the sections: the system's own search tab from iOS 18 (ios/tabs.m), the search page and its field here. */
export const SEARCH_TAB = { id: "search", title: "Search", icon: "magnifyingglass" };

/** A section's id on both sides of the bridge: Movies and Series are both Discover, so the type tells them apart. */
export function tabId(route: TabRoute): string {
  return route.name === "discover" ? `discover:${route.type}` : route.name;
}

/**
 * What iOS's tab bar shows for these sections: the current one is the stack's root (a shelf's heading opens Movies
 * at a catalog, still Movies), Search when the search tab opened the stack, none when the root is no tab; hidden over the player and over anything
 * that covers the screen (`covered`).
 */
export function nativeTabsState(links: NavLink[], stack: Entry[], covered: boolean): NativeTabsState {
  const tabs = [...links.map((l) => ({ id: tabId(l.route), title: l.label, icon: ICONS[tabId(l.route)] ?? "square" })), SEARCH_TAB];
  const root = tabId(rootTab(stack));
  const playing = stack[stack.length - 1].route.name === "player";
  return { tabs, selected: tabs.some((t) => t.id === root) ? root : null, hidden: playing || covered };
}

/** The section a picked tab opens. */
export function tabRoute(links: NavLink[], id: string): TabRoute | undefined {
  if (id === SEARCH_TAB.id) return { name: "search" };
  return links.find((l) => tabId(l.route) === id)?.route;
}

const COLLECTIONS = { saved: "Saved", watched: "Watched", playlists: "Playlists", downloads: "Downloads" } as const;

/** A page's name in iOS's back button menu (components/NativeBack.tsx). */
export function routeTitle(route: Route): string {
  switch (route.name) {
    case "home":
      return "Home";
    case "discover":
      return route.type === "movie" ? "Movies" : "Series";
    case "anime":
      return "Anime";
    case "library":
      return "Library";
    case "calendar":
      return "Calendar";
    case "search":
      return "Search";
    case "settings":
      return "Settings";
    case "detail":
      return route.preview?.name ?? (route.type === "movie" ? "Movie" : "Series");
    case "anime-detail":
      return route.preview?.title.english ?? route.preview?.title.romaji ?? "Anime";
    case "anime-schedule":
      return "Schedule";
    case "anime-browse":
      return route.title ?? "Anime";
    case "library-collection":
      return COLLECTIONS[route.view];
    case "playlist":
      return "Playlist";
    case "player":
      return "Player";
  }
}

/** The pages behind the top of the stack, nearest first. */
export function backHistory(stack: Entry[]): string[] {
  return stack
    .slice(0, -1)
    .reverse()
    .map((e) => routeTitle(e.route));
}
