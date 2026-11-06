import { useEffect, useRef } from "react";

/**
 * One Escape for every layer (docs/ui-components.md U11, critique M25). Each open layer (a sheet, the
 * trailer, the player's options, a TV panel or menu) pushes itself on a stack; Escape closes the one on
 * top, and only that one. TV's other Back keys close it through `dismissTop`.
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
const depthListeners = new Set<() => void>();

/** Adds a layer on top; returns its removal. */
export function pushDismiss(dismiss: () => void): () => void {
  const entry: Entry = { dismiss };
  stack.push(entry);
  install();
  depthListeners.forEach((l) => l());
  return () => {
    const i = stack.lastIndexOf(entry);
    if (i < 0) return;
    stack.splice(i, 1);
    depthListeners.forEach((l) => l());
  };
}

/** How many layers are open (0: Escape goes on to the app). */
export const dismissDepth = () => stack.length;

/** Calls `listener` whenever a layer opens or closes; returns the unsubscribe. */
export function onDismissDepth(listener: () => void): () => void {
  depthListeners.add(listener);
  return () => void depthListeners.delete(listener);
}

type EscapeEvent = Pick<KeyboardEvent, "key" | "defaultPrevented" | "isComposing" | "preventDefault" | "stopPropagation">;

const dismissed = new Set<() => void>();

/** Calls `listener` after each layer closes through Escape or `dismissTop` (TV plays its back sound). */
export function onDismissed(listener: () => void): () => void {
  dismissed.add(listener);
  return () => void dismissed.delete(listener);
}

/** Closes the topmost layer, if there is one: for TV's other Back keys (Backspace, a remote's Back). */
export function dismissTop(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.dismiss();
  dismissed.forEach((l) => l());
  return true;
}

/** Closes the top layer for an unhandled Escape. Returns whether it did. Exported for tests. */
export function handleDismissKey(e: EscapeEvent): boolean {
  if (e.key !== "Escape" || e.defaultPrevented || e.isComposing || !stack.length) return false;
  e.preventDefault();
  e.stopPropagation();
  return dismissTop();
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
