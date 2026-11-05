/**
 * Spatial navigation: arrow keys (and a controller's D-pad, see gamepad.ts)
 * move focus to the nearest control on screen in that direction, the way a
 * TV remote does. Plain DOM — screens opt in with a few attributes:
 *
 *  - `data-nav-scope`   Focus stays inside the last (innermost / most recent)
 *                       visible scope: the shell, then any open menu or panel.
 *  - `data-nav-memory`  Remembers its last focused descendant, and goes back to
 *                       it when focus re-enters from outside. A shelf keeps its
 *                       place; leaving the navbar returns you to your card.
 *  - `data-nav-entry`   Where to land on entering a memory group that has no
 *                       memory yet (or whose memory has gone). With
 *                       `data-nav-prefer-entry`, always land there.
 *  - `data-nav-default` A screen's first focus.
 *  - `data-nav-home`    Within a scope, where focus belongs when it has to be
 *                       placed from nothing: the page on top, not the navbar.
 *  - `data-nav-lock-x`  Like a rail, left/right never leaves it (the navbar).
 *  - `data-nav-rail`    A sideways scroller: the focused card is pinned to its
 *                       start edge, so your eye stays put as the shelf slides.
 *  - `data-nav-scroll`  A vertical scroller: "start" brings the focused
 *                       `data-nav-row` to the top, "center" centres it.
 *  - `data-nav-own`     Handles its own arrow keys (sliders and the like).
 *  - `data-nav-keep`    A new page leaves focus here (focusWhenReady's
 *                       `respectKeep`): the section tabs, the search field.
 */
import { prefersReducedMotion } from "../lib/ui";

export type Dir = "up" | "down" | "left" | "right";

export const KEY_DIRS: Record<string, Dir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

const FOCUSABLE = "button, a[href], input, select, textarea, [tabindex]";
const memory = new WeakMap<Element, HTMLElement>();

const reducedMotion = prefersReducedMotion;

export function isNavigable(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if ((el as HTMLButtonElement).disabled || el.tabIndex < 0) return false;
  if (el.closest("[inert]")) return false;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  return el.checkVisibility({ visibilityProperty: true });
}

export function navigables(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll(FOCUSABLE)].filter(isNavigable);
}

/** The innermost visible scope: an open panel or menu beats the shell. */
export function activeScope(): HTMLElement | null {
  const scopes = [...document.querySelectorAll<HTMLElement>("[data-nav-scope]")].filter(
    (s) => !s.closest("[inert]") && s.checkVisibility({ visibilityProperty: true }),
  );
  return scopes[scopes.length - 1] ?? null;
}

/** Record focus for every memory group around the focused element. */
export function remember(el: HTMLElement) {
  for (let g = el.parentElement?.closest("[data-nav-memory]"); g; g = g.parentElement?.closest("[data-nav-memory]")) {
    memory.set(g, el);
  }
}

/**
 * Where focus should land inside `root`: where you last were, else the
 * screen's default, an entry point, or the first control. With
 * `data-nav-prefer-entry` (the navbar: land on the current tab) the entry
 * point comes first.
 */
export function landingIn(root: Element): HTMLElement | null {
  // The shell defers to the page you're on (not, say, the navbar's current tab).
  const home = root.querySelector("[data-nav-home]");
  if (home && home !== root) {
    const inHome = landingIn(home);
    if (inHome) return inHome;
  }
  const first = (sel: string) => [...root.querySelectorAll(sel)].find(isNavigable) ?? null;
  const remembered = memory.get(root);
  const recalled = remembered?.isConnected && root.contains(remembered) && isNavigable(remembered) ? remembered : null;
  if (root.hasAttribute("data-nav-prefer-entry")) {
    return first("[data-nav-entry]") ?? recalled ?? navigables(root)[0] ?? null;
  }
  return recalled ?? first("[data-nav-default]") ?? first("[data-nav-entry]") ?? navigables(root)[0] ?? null;
}

// --- Geometry ---------------------------------------------------------------

/** Distance between two ranges on one axis; 0 when they overlap. */
const gap = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, b1 - a2, a1 - b2);

/**
 * How good a move from `a` to `b` is in `dir` (lower is better), or Infinity
 * if `b` isn't that way. Mostly distance along the axis; sitting off to the
 * side (no overlap) costs three times as much, so moving down from a card
 * lands on the card below it rather than a nearer one diagonally.
 */
function score(a: DOMRect, b: DOMRect, dir: Dir) {
  const acx = (a.left + a.right) / 2;
  const acy = (a.top + a.bottom) / 2;
  const bcx = (b.left + b.right) / 2;
  const bcy = (b.top + b.bottom) / 2;
  let along: number;
  let side: number;
  let drift: number;
  switch (dir) {
    case "right":
      if (bcx <= acx || b.left < acx) return Infinity;
      along = Math.max(0, b.left - a.right);
      side = gap(a.top, a.bottom, b.top, b.bottom);
      drift = Math.abs(bcy - acy);
      break;
    case "left":
      if (bcx >= acx || b.right > acx) return Infinity;
      along = Math.max(0, a.left - b.right);
      side = gap(a.top, a.bottom, b.top, b.bottom);
      drift = Math.abs(bcy - acy);
      break;
    case "down":
      if (bcy <= acy || b.top < acy) return Infinity;
      along = Math.max(0, b.top - a.bottom);
      side = gap(a.left, a.right, b.left, b.right);
      drift = Math.abs(bcx - acx);
      break;
    case "up":
      if (bcy >= acy || b.bottom > acy) return Infinity;
      along = Math.max(0, a.top - b.bottom);
      side = gap(a.left, a.right, b.left, b.right);
      drift = Math.abs(bcx - acx);
      break;
  }
  return along + side * 3 + drift * 0.05;
}

/** The best control in `dir` from `from`, among `candidates`. */
function nearest(from: HTMLElement, candidates: HTMLElement[], dir: Dir) {
  const a = from.getBoundingClientRect();
  const horizontal = dir === "left" || dir === "right";
  // At the end of a shelf (or the navbar), left/right stops — it never jumps to another row.
  const inRail = horizontal && !!from.closest("[data-nav-rail], [data-nav-lock-x]");
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of candidates) {
    if (el === from || el.contains(from) || from.contains(el)) continue;
    const b = el.getBoundingClientRect();
    if (inRail && gap(a.top, a.bottom, b.top, b.bottom) > 0) continue;
    const s = score(a, b, dir);
    if (s < bestScore) {
      bestScore = s;
      best = el;
    }
  }
  return best;
}

/**
 * Entering a memory group from outside goes back to where you were in it.
 * The outermost group wins: coming down from the navbar restores the page's
 * last card, not just the right shelf.
 */
function resolveEntry(from: HTMLElement, target: HTMLElement) {
  let entered: Element | null = null;
  for (let g = target.closest("[data-nav-memory]"); g; g = g.parentElement?.closest("[data-nav-memory]") ?? null) {
    if (!g.contains(from)) entered = g;
  }
  return (entered && landingIn(entered)) ?? target;
}

// --- Moving -----------------------------------------------------------------

/** Move focus one step in `dir`. Returns false when there's nowhere to go. */
export function move(dir: Dir): boolean {
  const scope = activeScope();
  if (!scope) return false;
  const current = document.activeElement;
  if (!(current instanceof HTMLElement) || current === document.body || !scope.contains(current)) {
    const first = landingIn(scope);
    if (first) focusEl(first);
    return !!first;
  }
  const target = nearest(current, navigables(scope), dir);
  if (!target) return false;
  focusEl(resolveEntry(current, target));
  return true;
}

/** Focus without the browser's jump-scroll, then glide it into place. */
export function focusEl(el: HTMLElement, smooth = true) {
  el.focus({ preventScroll: true });
  reveal(el, smooth);
}

/** Offset of `el` within a positioned ancestor, ignoring transforms (a focused card's scale). */
function offsetWithin(el: HTMLElement, ancestor: HTMLElement) {
  let left = 0;
  let top = 0;
  let node: HTMLElement | null = el;
  while (node && node !== ancestor) {
    left += node.offsetLeft;
    top += node.offsetTop;
    const parent = node.offsetParent as HTMLElement | null;
    // Not positioned relative to the ancestor: fall back to on-screen geometry.
    if (parent && !ancestor.contains(parent) && parent !== ancestor) {
      const a = ancestor.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return { left: r.left - a.left + ancestor.scrollLeft, top: r.top - a.top + ancestor.scrollTop };
    }
    node = parent;
  }
  return { left, top };
}

/** Bring a newly focused control into place: pinned in its shelf, its row where the screen wants it. */
export function reveal(el: HTMLElement, smooth = true) {
  const behavior: ScrollBehavior = smooth && !reducedMotion() ? "smooth" : "instant";

  const rail = el.closest<HTMLElement>("[data-nav-rail]");
  if (rail) {
    const card = [...rail.children].find((c) => c.contains(el)) as HTMLElement | undefined;
    const start = parseFloat(getComputedStyle(rail).scrollPaddingInlineStart) || 0;
    if (card) rail.scrollTo({ left: offsetWithin(card, rail).left - start, behavior });
  }

  const scroller = el.closest<HTMLElement>("[data-nav-scroll]");
  if (!scroller) return;
  const row = el.closest<HTMLElement>("[data-nav-row]");
  const target = row && scroller.contains(row) ? row : el;
  const { top } = offsetWithin(target, scroller);
  const style = getComputedStyle(scroller);
  const padTop = parseFloat(style.scrollPaddingTop) || 0;
  const padBottom = parseFloat(style.scrollPaddingBottom) || 0;
  const view = scroller.clientHeight;
  const h = target.offsetHeight;
  let next: number;
  switch (scroller.dataset.navScroll) {
    case "start":
      next = top - padTop;
      break;
    case "center":
      next = top - (view - h) / 2;
      break;
    default: {
      const s = scroller.scrollTop;
      if (top - padTop < s) next = top - padTop;
      else if (top + h + padBottom > s + view) next = top + h + padBottom - view;
      else return;
    }
  }
  scroller.scrollTo({ top: Math.max(0, next), behavior });
}

/**
 * Put focus somewhere sensible inside `root` once it has something to focus
 * (screens fill in as data arrives); gives up after a few seconds. With
 * `respectKeep`, it also leaves focus alone while it's somewhere marked
 * `data-nav-keep` — switching sections from the navbar keeps you there.
 */
export function focusWhenReady(root: HTMLElement | null, { respectKeep = false } = {}) {
  let cancelled = false;
  let frames = 0;
  const tick = () => {
    if (cancelled || !root?.isConnected) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) {
      if (root.contains(active) && isNavigable(active)) return;
      if (respectKeep && active.closest("[data-nav-keep]")) return;
    }
    // Wait while a panel or menu above this root has the focus scope.
    const scope = activeScope();
    if (scope && !scope.contains(root) && !root.contains(scope)) {
      if (frames++ < 240) requestAnimationFrame(tick);
      return;
    }
    const target = landingIn(root);
    if (target) return focusEl(target, false);
    if (frames++ < 240) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => {
    cancelled = true;
  };
}

/** Tracks focus for memory groups. Install once. */
export function installFocusMemory() {
  const onFocus = (e: FocusEvent) => e.target instanceof HTMLElement && remember(e.target);
  document.addEventListener("focusin", onFocus);
  return () => document.removeEventListener("focusin", onFocus);
}

/**
 * The mouse highlights what it rests on, the way the arrows do, so pointing
 * and the remote meet in one place: hover a card and it lifts, and the arrows
 * carry on from there. Only real movement counts (a card sliding under a
 * still cursor doesn't steal focus), and nothing scrolls to meet the pointer.
 */
export function installPointerFocus() {
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || (!e.movementX && !e.movementY)) return;
    const hit = e.target instanceof Element ? e.target.closest(FOCUSABLE) : null;
    if (!(hit instanceof HTMLElement) || hit === document.activeElement || !isNavigable(hit)) return;
    // Text fields would summon typing; sliders take the arrows.
    if (hit instanceof HTMLTextAreaElement || (hit instanceof HTMLInputElement && !["button", "checkbox", "radio", "submit"].includes(hit.type))) return;
    // Under an open menu or panel, the page doesn't react.
    const scope = activeScope();
    if (scope && !scope.contains(hit)) return;
    hit.focus({ preventScroll: true });
  };
  window.addEventListener("pointermove", onMove, { passive: true });
  return () => window.removeEventListener("pointermove", onMove);
}

/** Whether the focused element wants the arrow keys for itself. */
export function ownsArrows(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest("[data-nav-own]")) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !["button", "checkbox", "radio", "submit"].includes(target.type);
}
