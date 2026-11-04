import { useEffect, type RefObject } from "react";
import { prefersReducedMotion } from "./reducedMotion";

/** Wheel events right after a jump belong to the jump (a trackpad's tail), not to a new one. */
const LOCK_MS = 650;

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

    const fold = () => {
      const h = el.querySelector<HTMLElement>(hero);
      if (!h) return 0;
      // Where the page below the hero starts, just clear of the navigation bar.
      const nav = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-h")) || 76;
      const target = h.offsetTop + h.offsetHeight - nav - 8;
      return Math.max(0, Math.min(target, el.scrollHeight - el.clientHeight));
    };

    const go = (top: number) => {
      lockedUntil = performance.now() + LOCK_MS;
      el.scrollTo({ top, behavior: prefersReducedMotion() ? "auto" : "smooth" });
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
        if (now >= lockedUntil) go(target);
      } else if (e.deltaY < 0 && y > 0 && y <= target + 4) {
        e.preventDefault();
        if (now >= lockedUntil) go(0);
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scroller, ready, hero]);
}
