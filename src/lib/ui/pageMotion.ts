import { useEffect, useState } from "react";
import type { Entry, TabRoute } from "../router";
import { SEARCH_TAB, tabId } from "../navTabs";

/** The sections in the order the tab bars show them (NavBar's links, then iOS's search tab). */
const ORDER = ["home", "discover:series", "discover:movie", "anime", "library", "calendar", SEARCH_TAB.id];

/** How long a change's pages keep their motion: the entrance (shell.css), and a frame to spare. */
const SETTLE = 300;

/**
 * A page change on a phone, for shell.css to play: `enter` is the page coming in, `leave` the one going, `dir`
 * where the new one comes from (1: the right, -1: the left, 0: in place). `leaving`: the page going when it's
 * no longer in the stack (Back, a tab switch), to render once more while it leaves.
 */
export type PageMotion = { enter: number; leave: number; dir: -1 | 0 | 1; leaving?: Entry };

type Seen = { top?: Entry; keys: number[]; root?: TabRoute; motion?: PageMotion };

/**
 * Pages on a phone move as a pair, so a change reads as one gesture: the new page fades in from one side while the
 * old one fades out towards the other. Forward is from the right: a title opened, or a section further along the
 * tab bar; back is from the left. The pair moves together; nothing waits for the other.
 */
export function usePageMotion(pages: Entry[], enabled: boolean): PageMotion | undefined {
  const top = pages[pages.length - 1];
  const [seen, setSeen] = useState<Seen>(() => ({ top, keys: pages.map((e) => e.key), root: pages[0]?.route as TabRoute | undefined }));
  let now = seen;
  if (top?.key !== seen.top?.key) {
    now = { top, keys: pages.map((e) => e.key), root: pages[0]?.route as TabRoute | undefined };
    if (enabled && top && seen.top) now.motion = motionOf(seen, seen.top, top, pages);
    setSeen(now); // during render: this render already draws the change with its motion
  }

  useEffect(() => {
    if (!seen.motion) return;
    const t = window.setTimeout(() => setSeen((s) => (s === seen ? { ...s, motion: undefined } : s)), SETTLE);
    return () => window.clearTimeout(t);
  }, [seen]);

  return now.motion;
}

function motionOf(seen: Seen, prev: Entry, top: Entry, pages: Entry[]): PageMotion {
  const base = { enter: top.key, leave: prev.key };
  // Pushed: the page that was on top is still there, under the new one.
  if (pages.some((e) => e.key === prev.key)) return { ...base, dir: 1 };
  // Back: the page now on top was under the one that's gone.
  if (seen.keys.includes(top.key)) return { ...base, dir: -1, leaving: prev };
  // Another section: towards it along the tab bar. Replaced in place: a crossfade.
  const from = seen.root ? ORDER.indexOf(tabId(seen.root)) : -1;
  const to = ORDER.indexOf(tabId(pages[0].route as TabRoute));
  const dir = pages.length > 1 || from < 0 || to < 0 || from === to ? 0 : to > from ? 1 : -1;
  return { ...base, dir, leaving: prev };
}
