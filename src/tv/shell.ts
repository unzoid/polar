import { createContext, useContext, useEffect, useRef, type RefObject } from "react";
import { focusWhenReady, pushBack } from "./spatial";

/** Whether this screen is the one on top (not under a pushed page, the player, or the menu). */
export const PageActive = createContext(true);
export const usePageActive = () => useContext(PageActive);

/** While `active`, Back (Esc, Backspace, B) runs `handler` instead of leaving the page. */
export function useBack(active: boolean, handler: () => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => (active ? pushBack(ref) : undefined), [active]);
}

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
