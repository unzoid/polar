import { os } from "./device";

/**
 * iOS's long press: WebKit there fires no `contextmenu` for a finger held on an element, so a card's options
 * (CardMenu) would be out of reach. Held still for HOLD_MS, the touch becomes one: `onLongPress` hears it and
 * the app sends the `contextmenu` a right-click would. A touch that moves (a scroll), lifts early or adds a
 * finger isn't one.
 */
export const longPressMenus = os === "ios";

/** How long the finger stays down (ms): UIKit's own long press takes 0.5 s. */
export const HOLD_MS = 500;
/** How far it may drift and still be held (CSS px). */
export const SLOP_PX = 10;

export type Held = { target: EventTarget | null; x: number; y: number };

type Clock = { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void };
const realClock: Clock = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id as number) };

/**
 * Hear long presses on `target` until the returned function is called. `handler` answers whether it used the
 * press; if it did, the click the finger's lifting then makes is swallowed, so the card isn't opened too.
 */
export function onLongPress(
  handler: (held: Held) => boolean,
  target: Pick<Window, "addEventListener" | "removeEventListener"> = window,
  clock: Clock = realClock,
): () => void {
  let from: Held | null = null;
  let timer: unknown;
  let swallow = false;
  const stop = () => {
    if (timer !== undefined) clock.clear(timer);
    timer = undefined;
    from = null;
  };
  const start = (e: TouchEvent) => {
    stop();
    swallow = false;
    const t = e.touches[0];
    if (!t || e.touches.length > 1) return;
    from = { target: e.target, x: t.clientX, y: t.clientY };
    timer = clock.set(() => {
      timer = undefined;
      const held = from;
      from = null;
      if (held) swallow = handler(held);
    }, HOLD_MS);
  };
  const move = (e: TouchEvent) => {
    const t = e.touches[0];
    if (!from || !t) return;
    if (e.touches.length > 1 || Math.hypot(t.clientX - from.x, t.clientY - from.y) > SLOP_PX) stop();
  };
  const click = (e: Event) => {
    if (!swallow) return;
    swallow = false;
    e.preventDefault();
    e.stopPropagation();
  };
  const passive = { passive: true, capture: true };
  const listeners = [
    ["touchstart", start, passive],
    ["touchmove", move, passive],
    ["touchend", stop, passive],
    ["touchcancel", stop, passive],
    ["click", click, { capture: true }],
  ] as const;
  for (const [type, fn, opts] of listeners) target.addEventListener(type, fn as EventListener, opts);
  return () => {
    stop();
    for (const [type, fn, opts] of listeners) target.removeEventListener(type, fn as EventListener, opts);
  };
}

/**
 * The `contextmenu` a right-click at the held point would send, sent to what the finger is on. True when a
 * menu took it: menus stop it there, while the app's catch-all (which only keeps the web view's own menu
 * away) lets it reach the window.
 */
export function openContextMenu({ target, x, y }: Held, scope: Pick<Window, "addEventListener" | "removeEventListener"> = window): boolean {
  if (!(target instanceof Element)) return false;
  let reached = false;
  const seen = () => (reached = true);
  scope.addEventListener("contextmenu", seen);
  const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y });
  target.dispatchEvent(e);
  scope.removeEventListener("contextmenu", seen);
  return e.defaultPrevented && !reached;
}
