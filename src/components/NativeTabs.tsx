import { useEffect, useRef, useSyncExternalStore } from "react";
import { nativeTabsAvailable, onNativeTab, setNativeTabs, type NativeTabsState } from "../lib/platform";
import { useRouter } from "../lib/router";
import { nativeTabsState, SEARCH_TAB, tabRoute, type NavLink } from "../lib/navTabs";
import { focusSearch } from "../lib/catalog";
import { useSettingsOverlay } from "../lib/settings";
import { dismissDepth, onDismissDepth } from "../lib/ui";
import { warnFailed } from "../lib/errors";

/**
 * On iOS the sections are iOS's own tab bar (lib/platform/nativeTabs.ts), kept in step with the router both ways:
 * a tab picked there opens its section (picking the current one again goes back to its top, as on iOS), and Back,
 * deep links and watch parties move the bar with them; the search tab opens the search page with its field focused.
 * The web-drawn tabs hide (shell.css). Elsewhere nothing.
 */
export function useNativeTabs(links: NavLink[]) {
  const { stack, tab } = useRouter();
  const settingsOpen = useSettingsOverlay().open;
  const layers = useSyncExternalStore(onDismissDepth, dismissDepth);
  const state = nativeTabsState(links, stack, settingsOpen || layers > 0);
  const key = JSON.stringify(state);

  const latest = useRef({ links, tab });
  latest.current = { links, tab };

  useEffect(() => {
    if (!nativeTabsAvailable) return;
    const root = document.documentElement;
    root.dataset.nativeTabs = "true";
    let unlisten: (() => void) | undefined;
    let gone = false;
    void onNativeTab((id) => {
      const route = tabRoute(latest.current.links, id);
      if (route) latest.current.tab(route);
      // The search tab opens search: on a phone its own page (its field focuses when it's open already),
      // on an iPad the field in the top bar, with its suggestions.
      if (id === SEARCH_TAB.id) focusSearch();
    }).then((u) => (gone ? u() : (unlisten = u)));
    // Leaving this shell takes the bar away with it.
    return () => {
      gone = true;
      unlisten?.();
      delete root.dataset.nativeTabs;
      setNativeTabs({ tabs: [], selected: null, hidden: true }).catch(warnFailed("native tab bar"));
    };
  }, []);

  useEffect(() => {
    if (nativeTabsAvailable) setNativeTabs(JSON.parse(key) as NativeTabsState).catch(warnFailed("native tab bar"));
  }, [key]);
}
