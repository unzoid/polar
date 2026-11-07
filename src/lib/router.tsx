import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AnimeCard, BrowseFilters } from "./anime/anilist";
import type { ContentType, MetaPreview, Stream } from "./types";
import { isLinkId } from "./party/links";
import { isFileId } from "./localFiles/ids";

export type TabRoute =
  | { name: "home" }
  /** Movies or Series; from a Home shelf's heading, opened at that shelf's catalog and genre (#48). */
  /** `addon`: `catalog` is that add-on's (#206), not one of Polarity's. */
  | { name: "discover"; type: ContentType; catalog?: string; genre?: string; addon?: string }
  | { name: "anime" }
  | { name: "library" }
  | { name: "calendar" }
  | { name: "search" }
  | { name: "settings"; page?: string };

export type Route =
  | TabRoute
  /** `entry`: TV mode with seasons as separate shows (#22), the AniList entry whose episodes the page shows. */
  | { name: "detail"; type: ContentType; id: string; preview?: MetaPreview; entry?: number }
  /** An anime's own page, by AniList id. */
  | { name: "anime-detail"; id: number; preview?: AnimeCard }
  | { name: "anime-schedule" }
  /** The anime grid; from a shelf's heading (#48), with that shelf's filters and its title. */
  | ({ name: "anime-browse"; title?: string } & Partial<Pick<BrowseFilters, "genre" | "tag" | "season" | "year" | "format" | "sort">>)
  /** One of Library's collections in full; `fresh`: a playlist just made, its name selected to type over. */
  | { name: "library-collection"; view: "saved" | "watched" | "playlists" | "downloads" }
  | { name: "playlist"; id: string; fresh?: boolean }
  | { name: "player"; type: ContentType; metaId: string; videoId: string; stream?: Stream };

export interface Entry {
  key: number;
  route: Route;
}

interface Router {
  stack: Entry[];
  current: Route;
  navigate: (route: Route) => void;
  /** Switch top-level tab: resets the stack. */
  tab: (route: TabRoute) => void;
  replace: (route: Route) => void;
  back: () => void;
}

const RouterContext = createContext<Router | null>(null);
const MAX_DEPTH = 8;
let nextKey = 100;

/**
 * A stack router. Screens below the top stay mounted (hidden with
 * `content-visibility`), so going back is instant and keeps scroll position —
 * no refetch, no re-layout, no lost place in a long grid.
 */
export function RouterProvider({ children, initial }: { children: ReactNode; initial?: Route[] }) {
  const [stack, setStack] = useState<Entry[]>(() =>
    (initial ?? [{ name: "home" }]).map((route, key) => ({ key, route })),
  );

  const navigate = useCallback((route: Route) => {
    setStack((s) => pushed(s, route, () => nextKey++));
  }, []);
  const tab = useCallback((route: TabRoute) => {
    setStack((s) =>
      s.length === 1 && sameRoute(s[0].route, route) ? s : [{ key: nextKey++, route }],
    );
  }, []);
  const replace = useCallback((route: Route) => {
    setStack((s) => [...s.slice(0, -1), { key: nextKey++, route }]);
  }, []);
  const back = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  // Mouse "back" button, like every native app.
  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener("mouseup", onMouse);
    return () => window.removeEventListener("mouseup", onMouse);
  }, [back]);

  const value = useMemo(
    () => ({ stack, current: stack[stack.length - 1].route, navigate, tab, replace, back }),
    [stack, navigate, tab, replace, back],
  );
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("useRouter outside RouterProvider");
  return ctx;
}

/**
 * `stack` with `route` on top. The player always goes over its title's page, so Back from it lands
 * there whatever started it (Continue Watching, Downloads, a card's menu: test report 1, item 5);
 * a second Back returns to where you were. Deep stacks drop their oldest pushed pages, never the
 * tab at the bottom (rootTab reads it).
 */
export function pushed(stack: Entry[], route: Route, key: () => number): Entry[] {
  const top = stack[stack.length - 1].route;
  const add: Route[] = [];
  // A pasted link (#136) and a file on this device (#204) have no title page.
  if (route.name === "player" && !isLinkId(route.metaId) && !isFileId(route.metaId) && top.name !== "player" && top.name !== "anime-detail" && !(top.name === "detail" && top.id === route.metaId))
    add.push({ name: "detail", type: route.type, id: route.metaId });
  add.push(route);
  const next = [...stack, ...add.map((r) => ({ key: key(), route: r }))];
  return next.length > MAX_DEPTH ? [next[0], ...next.slice(-(MAX_DEPTH - 1))] : next;
}

function sameRoute(a: Route, b: Route) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Which top-level nav item a route belongs to. */
export function rootTab(stack: Entry[]): TabRoute {
  return stack[0].route as TabRoute;
}
