import { useEffect, useRef, type RefObject } from "react";
import { useDismiss } from "./dismiss";

/**
 * What a modal layer does besides drawing itself (docs/ui-components.md U11): Escape through the shared
 * dismiss stack (`useDismiss`), focus moved into it when it opens, Tab kept inside it, and focus given back
 * to where it was when it closes. Base UI's `Dialog` (party join, settings) does the same by itself; this is
 * for the layers drawn with motion (`Sheet`, the trailer), which keep their own scrim and timing.
 */

/** What Tab can reach inside a layer. */
const TABBABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "video[controls]",
  "[tabindex]:not([tabindex='-1'])",
  "[contenteditable='true']",
].join(",");

/**
 * Where Tab should go instead of its default, or null to let it be. `count` tabbables in the layer, focus
 * on the one at `index` (-1: on none of them), `back` for Shift+Tab, `inside` whether focus is in the layer
 * at all, `outside` whether it is on something else on the page (a menu portalled to the body), which is
 * left alone. Only the edges wrap; focus on nothing (the body) is pulled in.
 */
export function trapTarget(count: number, index: number, back: boolean, inside: boolean, outside = false): number | null {
  if (outside) return null;
  if (count === 0) return -1; // nothing to tab to: keep focus on the layer itself
  if (!inside || index < 0) return back ? count - 1 : 0;
  if (back && index === 0) return count - 1;
  if (!back && index === count - 1) return 0;
  return null;
}

type Trap = { root: RefObject<HTMLElement | null> };

/** Open modal layers, topmost last: only the top one keeps Tab. */
const traps: Trap[] = [];

function visible(el: HTMLElement) {
  return el.offsetParent !== null || getComputedStyle(el).position === "fixed";
}

function onTab(e: KeyboardEvent) {
  if (e.key !== "Tab" || e.defaultPrevented) return;
  const root = traps[traps.length - 1]?.root.current;
  if (!root) return;
  const items = [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(visible);
  const active = document.activeElement;
  const inside = !!active && root.contains(active);
  const outside = !inside && !!active && active !== document.body && active !== document.documentElement;
  const target = trapTarget(items.length, active ? items.indexOf(active as HTMLElement) : -1, e.shiftKey, inside, outside);
  if (target === null) return;
  e.preventDefault();
  (target < 0 ? root : items[target]).focus();
}

let installed = false;
function install() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("keydown", onTab);
}

/**
 * While `open`: Escape calls `onClose` (when this is the top layer). With `modal` (the default), focus
 * moves to `root` when it opens (give it `tabIndex={-1}`), Tab cycles inside it, and focus goes back to the
 * element that had it when the layer closes, if that is still on the page.
 */
export function useLayer(root: RefObject<HTMLElement | null>, open: boolean, onClose: () => void, { modal = true } = {}) {
  useDismiss(open, onClose);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    if (!open || !modal) return;
    opener.current = document.activeElement;
    const trap: Trap = { root };
    traps.push(trap);
    install();
    const el = root.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    return () => {
      const i = traps.lastIndexOf(trap);
      if (i >= 0) traps.splice(i, 1);
      const back = opener.current;
      opener.current = null;
      // Only when focus is still in the closing layer (or was dropped): a click elsewhere keeps its focus.
      const now = document.activeElement;
      const dropped = !now || now === document.body || (root.current?.contains(now) ?? false);
      if (back instanceof HTMLElement && back.isConnected && dropped) back.focus({ preventScroll: true });
    };
  }, [open, modal, root]);
}
