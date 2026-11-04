import { createContext, useContext, useEffect, type RefObject } from "react";
import { useDismiss } from "../lib/dismiss";
import { focusWhenReady } from "./spatial";

/** Whether this screen is the one on top (not under a pushed page, the player, or the menu). */
export const PageActive = createContext(true);
export const usePageActive = () => useContext(PageActive);

/**
 * While `active`, Back (Esc, Backspace, B) runs `handler` instead of leaving the page. A layer on the one
 * dismiss stack (lib/dismiss.ts), so TV panels and the app's sheets and overlays close in the order they
 * opened.
 */
export const useBack = useDismiss;

/**
 * For panels and menus: take focus when opened, and hand it back to whatever
 * opened them when closed, so Back lands you where you were.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const opener = document.activeElement;
    const cancel = focusWhenReady(ref.current);
    return () => {
      cancel();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [ref]);
}
