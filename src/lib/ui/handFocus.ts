import { useLayoutEffect, type RefObject } from "react";

/**
 * A control that hides itself (aria-hidden, out of the tab order) must not keep the focus while it
 * does: keyboard and screen-reader users would be left on something hidden and disabled (test
 * report 1, item 25). When `hidden` turns true with focus inside `ref`, focus moves to `to()` (the
 * player's surface, so its keys keep working) or, with none, the nearest focusable ancestor or the page.
 */
export function useHandFocus(ref: RefObject<HTMLElement | null>, hidden: boolean, to?: () => HTMLElement | null | undefined) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!hidden || !el || !el.contains(document.activeElement)) return;
    const next = to?.() ?? el.parentElement?.closest<HTMLElement>("[tabindex]");
    if (next) next.focus({ preventScroll: true });
    else (document.activeElement as HTMLElement | null)?.blur();
    // `to` is read once, when the control hides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden, ref]);
}
