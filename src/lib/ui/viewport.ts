import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Viewport hooks for lists that load as they scroll (docs/ui-components.md U2, U3).
 *
 * Pages scroll inside their own `.scroll` container, not the window, so that container is the observer's
 * root. With the window as root the margin would be useless: whatever lies below the container's edge is
 * clipped by it and counts as out of view until it scrolls in.
 */

const scrollRoot = (el: Element) => el.closest(".scroll");

/**
 * While `active`, marks the element `data-offscreen` whenever none of it is in view, without a re-render, so CSS
 * can pause what nobody sees: a loading shelf's shimmer repaints on every frame wherever it is, and a long page
 * holds dozens of them (#134).
 */
export function useOffscreenMark(ref: RefObject<Element | null>, active: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const io = new IntersectionObserver(([e]) => el.toggleAttribute("data-offscreen", !e.isIntersecting), { root: scrollRoot(el) });
    io.observe(el);
    return () => {
      io.disconnect();
      el.removeAttribute("data-offscreen");
    };
  }, [ref, active]);
}

/**
 * Turns true once the element comes within `margin` px below the visible part of its page, and stays true.
 * `eager` starts it true (the first shelves on a page).
 */
export function useNearViewport<T extends Element>(eager = false, margin = 700): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(eager);
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { root: scrollRoot(el), rootMargin: `0px 0px ${margin}px 0px` });
    io.observe(el);
    return () => io.disconnect();
  }, [near, margin]);
  return [ref, near];
}

/** Where an element is against the visible part of its page. */
export type ViewportPlace = "in" | "near" | "far";

/**
 * {@link useNearViewport}'s latch, plus where the element is now, kept in a ref so it can be read when
 * it's needed (a queued request's turn) without re-rendering; `onChange` hears each move. "near" is
 * within `margin` px above or below the visible part.
 */
export function useViewportPlace<T extends Element>(onChange?: () => void, margin = 700): [RefObject<T | null>, boolean, RefObject<ViewportPlace>] {
  const ref = useRef<T>(null);
  const place = useRef<ViewportPlace>("far");
  const [near, setNear] = useState(false);
  const changed = useRef(onChange);
  changed.current = onChange;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let inView = false;
    let close = false;
    const update = () => {
      const next: ViewportPlace = inView ? "in" : close ? "near" : "far";
      if (close) setNear(true);
      if (next === place.current) return;
      place.current = next;
      changed.current?.();
    };
    const root = scrollRoot(el);
    const seen = new IntersectionObserver(([e]) => ((inView = e.isIntersecting), update()), { root });
    const around = new IntersectionObserver(([e]) => ((close = e.isIntersecting), update()), { root, rootMargin: `${margin}px 0px ${margin}px 0px` });
    seen.observe(el);
    around.observe(el);
    return () => {
      seen.disconnect();
      around.disconnect();
    };
  }, [margin]);
  return [ref, near, place];
}

/** The part of an infinite query a grid needs. */
export type Pager = {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isLoading: boolean;
  fetchNextPage: () => unknown;
};

/**
 * Asks for the next page while the returned element (an empty marker after the list) is within `margin` px of
 * the visible part of the page. The observer is made again when a page arrives, so a marker still in reach
 * asks for the one after it.
 */
export function useInfiniteSentinel<T extends Element>(pager: Pager | undefined, margin = 1200): RefObject<T | null> {
  const ref = useRef<T>(null);
  const more = pager?.hasNextPage ?? false;
  const busy = pager?.isFetchingNextPage ?? false;
  const fetchNext = pager?.fetchNextPage;
  useEffect(() => {
    const el = ref.current;
    if (!el || !more || busy || !fetchNext) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && fetchNext(), { root: scrollRoot(el), rootMargin: `${margin}px` });
    io.observe(el);
    return () => io.disconnect();
  }, [more, busy, fetchNext, margin]);
  return ref;
}
