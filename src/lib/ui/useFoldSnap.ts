import { useEffect, type RefObject } from "react";
import { prefersReducedMotion } from "./reducedMotion";

/** Wheel events right after a jump belong to the jump (a trackpad's tail), not to a new one. */
const LOCK_MS = 650;
/** How long the glide between the hero and the episodes takes. */
export const GLIDE_MS = 520;

/**
 * Where the glide from `start` to `target` is after `elapsed` ms: ease-out (quick start, gentle
 * landing). `target` is read again on every frame, so content above that changes height mid-way
 * (a description, the season tabs, images arriving) moves the landing point smoothly instead of
 * re-aiming a browser smooth scroll from scratch, which is what stuttered (re-test N8).
 */
export function glideAt(start: number, target: number, elapsed: number): number {
  const t = Math.min(1, Math.max(0, elapsed / GLIDE_MS));
  const eased = 1 - Math.pow(1 - t, 3);
  return t >= 1 ? target : start + (target - start) * eased;
}

/**
 * A title page is two places: the hero, and everything below it. A wheel turn
 * on either side takes the whole step: down from the hero lands the episodes
 * and details at the top of the window, up from just below lands the hero
 * again, instead of crawling through the art a few pixels at a time. Further
 * down, the wheel scrolls normally. Keys, scrollbar drags and touch are left
 * alone.
 */
export function useFoldSnap(scroller: RefObject<HTMLElement | null>, ready: boolean, hero = ".detail-hero") {
  useEffect(() => {
    if (!ready) return;
    const el = scroller.current;
    if (!el) return;
    let lockedUntil = 0;
    let frame = 0;

    const fold = () => {
      const h = el.querySelector<HTMLElement>(hero);
      if (!h) return 0;
      // Where the page below the hero starts, just clear of the navigation bar.
      const nav = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-h")) || 76;
      const target = h.offsetTop + h.offsetHeight - nav - 8;
      return Math.max(0, Math.min(target, el.scrollHeight - el.clientHeight));
    };

    // Up to the hero (0) or down to the fold, which is measured again each frame. The wheel stays
    // locked until it has landed and a moment after.
    const go = (down: boolean) => {
      cancelAnimationFrame(frame);
      const to = () => (down ? fold() : 0);
      if (prefersReducedMotion()) {
        lockedUntil = performance.now() + LOCK_MS;
        el.scrollTop = to();
        return;
      }
      const start = el.scrollTop;
      const began = performance.now();
      lockedUntil = began + GLIDE_MS + LOCK_MS;
      const step = (now: number) => {
        const elapsed = now - began;
        el.scrollTop = glideAt(start, to(), elapsed);
        if (elapsed < GLIDE_MS) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.defaultPrevented || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      // Something inside that scrolls on its own (a sheet, a list) keeps its wheel.
      const inner = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-wheel-own], .sheet");
      if (inner && el.contains(inner)) return;
      const target = fold();
      if (target < 80) return; // nothing below the hero to land on

      const now = performance.now();
      const y = el.scrollTop;
      if (e.deltaY > 0 && y < target - 4) {
        e.preventDefault();
        if (now >= lockedUntil) go(true);
      } else if (e.deltaY < 0 && y > 0 && y <= target + 4) {
        e.preventDefault();
        if (now >= lockedUntil) go(false);
      }
    };

    // Touch, keys or the scrollbar take over from a glide at once.
    const stop = () => cancelAnimationFrame(frame);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", stop);
    el.addEventListener("keydown", stop);
    return () => {
      stop();
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", stop);
      el.removeEventListener("keydown", stop);
    };
  }, [scroller, ready, hero]);
}
