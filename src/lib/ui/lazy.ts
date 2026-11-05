import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * `React.lazy` for a named export, so a screen loads its own chunk the first
 * time it's drawn (inside a `<Suspense>`). `preload()` fetches the chunk ahead
 * of time, where waiting would show (the player); it runs the import once.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyNamed<M extends Record<K, ComponentType<any>>, K extends keyof M>(
  load: () => Promise<M>,
  name: K,
): LazyExoticComponent<M[K]> & { preload: () => Promise<M> } {
  let loading: Promise<M> | undefined;
  const preload = () => (loading ??= load());
  return Object.assign(
    lazy(() => preload().then((m) => ({ default: m[name] }))),
    { preload },
  );
}

/** Runs `fn` once the page has nothing else to do (or after `timeout` ms). */
export function whenIdle(fn: () => void, timeout = 3000) {
  // Safari (the macOS and iOS web views) has no requestIdleCallback.
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(fn, { timeout });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(fn, 1000);
  return () => window.clearTimeout(id);
}
