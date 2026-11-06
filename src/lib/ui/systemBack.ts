import { useEffect, useRef } from "react";
import { onSystemBack } from "../platform/back";
import { isTextField } from "./keyboard";

/**
 * Android's back button and gesture (docs/plan-mobile.md §2.4) go through the same Back as Escape: an open
 * layer closes first (dismiss.ts), then the screen's own Back (the player, a pushed page, TV's Back).
 * Only at the start screen with nothing open does Back do something Escape doesn't.
 */

export type Where = {
  /** Something sits above the page: the player, the Settings overlay, a sheet or menu (dismissDepth). */
  open: boolean;
  /** Pages pushed above the tab's own page. */
  pushed: number;
  /** The tab at the bottom is Home. */
  atHome: boolean;
};

/** What Back does on a phone or tablet: Escape's Back, then Home, then the app closes. */
export function systemBackAction({ open, pushed, atHome }: Where): "escape" | "home" | "leave" {
  if (open || pushed > 0) return "escape";
  return atHome ? "leave" : "home";
}

/**
 * Presses Escape where it lands for a person: on what has focus, so an open menu closes itself; a text field
 * loses focus first (Back leaves the field, as on Android), so the Back reaches the page.
 */
export function pressEscape(doc: Document = document) {
  let target: Element | null = doc.activeElement;
  if (isTextField(target)) {
    target.blur();
    target = null;
  }
  (target ?? doc.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
}

/** While mounted, the system's Back calls the latest `handler` (registered once, so Back never falls to the default in between). */
export function useSystemBack(handler: () => void) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    let off: (() => void) | undefined;
    let gone = false;
    void onSystemBack(() => latest.current()).then((u) => (gone ? u() : (off = u)));
    return () => {
      gone = true;
      off?.();
    };
  }, []);
}
