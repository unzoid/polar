import { useEffect, useRef } from "react";

/**
 * One Escape for every layer (docs/ui-components.md U11, critique M25). Each open layer (a sheet, the
 * trailer) pushes itself on a stack; Escape closes the one on top, and only that one.
 *
 * The listener sits on `document` in the bubble phase, so the order is:
 * 1. what has focus: a search field clears itself, an open Base UI menu, select or popover closes itself
 *    (both stop the event);
 * 2. this stack: the topmost layer closes, and the event stops here;
 * 3. `window` listeners: the app's Escape → Back, the player's keys.
 * A handler earlier in that order that calls `preventDefault()` keeps the layers open.
 */

type Entry = { dismiss: () => void };

const stack: Entry[] = [];

/** Adds a layer on top; returns its removal. */
export function pushDismiss(dismiss: () => void): () => void {
  const entry: Entry = { dismiss };
  stack.push(entry);
  install();
  return () => {
    const i = stack.lastIndexOf(entry);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** How many layers are open (0: Escape goes on to the app). */
export const dismissDepth = () => stack.length;

type EscapeEvent = Pick<KeyboardEvent, "key" | "defaultPrevented" | "isComposing" | "preventDefault" | "stopPropagation">;

/** Closes the top layer for an unhandled Escape. Returns whether it did. Exported for tests. */
export function handleDismissKey(e: EscapeEvent): boolean {
  if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return false;
  const top = stack[stack.length - 1];
  if (!top) return false;
  e.preventDefault();
  e.stopPropagation();
  top.dismiss();
  return true;
}

let installed = false;
function install() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("keydown", handleDismissKey);
}

/**
 * While `active`, Escape calls `onDismiss` when this is the topmost layer. Layers opened later sit above
 * it. `onDismiss` may change between renders without moving the layer in the stack.
 */
export function useDismiss(active: boolean, onDismiss: () => void) {
  const latest = useRef(onDismiss);
  latest.current = onDismiss;
  useEffect(() => {
    if (!active) return;
    return pushDismiss(() => latest.current());
  }, [active]);
}
