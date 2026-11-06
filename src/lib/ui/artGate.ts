import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

/**
 * Which pictures have loaded or failed this session, so a card can hold its title logo back until the art behind
 * it is in (#173), and a card drawn again shows both at once. `Img` and the TV backdrop report here.
 */
const loaded = new Set<string>();
const broken = new Set<string>();
const listeners = new Map<string, Set<() => void>>();

function settle(set: Set<string>, url: string) {
  if (set.has(url)) return;
  set.add(url);
  listeners.get(url)?.forEach((fn) => fn());
}

export const markImageLoaded = (url: string) => settle(loaded, url);
export const markImageBroken = (url: string) => settle(broken, url);
export const imageLoaded = (url: string) => loaded.has(url);
export const imageBroken = (url: string) => broken.has(url);

/** Whether a chain of pictures (the first, then its fallbacks) is done: the first that hasn't failed has loaded, or all failed. */
export function chainSettled(chain: (string | null | undefined)[]) {
  const current = chain.find((u): u is string => !!u && !broken.has(u));
  return !current || loaded.has(current);
}

function subscribe(chain: string[], fn: () => void) {
  for (const u of chain) {
    let set = listeners.get(u);
    if (!set) listeners.set(u, (set = new Set()));
    set.add(fn);
  }
  return () => {
    for (const u of chain) {
      const set = listeners.get(u);
      set?.delete(fn);
      if (set?.size === 0) listeners.delete(u);
    }
  };
}

let watcher: IntersectionObserver | null | undefined;

/**
 * One observer for every waiting card: once one comes into view it's marked `data-art-seen`, which starts the
 * CSS wait (1.2 s, `art-late` in styles/base.css), so art that's lazy-loaded off-screen isn't counted as late. No timers in script.
 */
function seenWatcher() {
  if (watcher === undefined)
    watcher =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            for (const e of entries) {
              if (!e.isIntersecting) continue;
              e.target.setAttribute("data-art-seen", "");
              watcher!.unobserve(e.target);
            }
          });
  return watcher;
}

/**
 * Props for the element that holds a picture and the title drawn on it (a card's frame, a hero): `data-art` is
 * `pending` while the art (`src`, then `fallbacks`) is loading, then `ready` once it loaded, failed, or there's none.
 * While pending, CSS keeps its `.art-after` children (logo, name, scrim) hidden; they fade in with the art, or on
 * their own once the art has been in view for 1.2 s.
 */
export function useArtGate(src?: string | null, fallbacks?: (string | null | undefined)[]) {
  const chain = [src, ...(fallbacks ?? [])].filter((u, i, all): u is string => !!u && all.indexOf(u) === i);
  const key = chain.join("\n");
  const sub = useCallback((fn: () => void) => subscribe(key ? key.split("\n") : [], fn), [key]);
  const ready = useSyncExternalStore(
    sub,
    () => chainSettled(chain),
    () => true,
  );
  const el = useRef<Element | null>(null);
  // A new picture starts its wait again; a settled one stops watching.
  useEffect(() => {
    const node = el.current;
    const io = seenWatcher();
    if (!node || ready) return;
    node.removeAttribute("data-art-seen");
    if (!io) return void node.setAttribute("data-art-seen", "");
    io.observe(node);
    return () => io.unobserve(node);
  }, [key, ready]);
  const ref = useCallback((node: Element | null) => {
    el.current = node;
  }, []);
  return { ref, "data-art": ready ? ("ready" as const) : ("pending" as const) };
}
