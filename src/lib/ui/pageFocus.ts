import { useEffect, useLayoutEffect } from "react";

/** The control last focused in each page (`section[data-page-key]`), to give back on return. */
const lastFocused = new Map<string, HTMLElement>();

const pageOf = (key: string) => document.querySelector<HTMLElement>(`[data-page-key="${CSS.escape(key)}"]`);

/**
 * Focus follows the page on top (re-test 25): when a page is pushed over the one holding focus
 * (a card was clicked), focus moves into the new page, so it never stays on a control in a page
 * that has gone inert; when that page is on top again, the control it last had gets focus back
 * (the card that was clicked), so keyboard and TV users carry on where they were.
 * Pages go with `inert` alone: it hides them from assistive tech too, without aria-hidden's
 * conflict with a focused descendant.
 */
export function usePageFocus(topKey: string | undefined) {
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const page = (e.target as Element | null)?.closest?.<HTMLElement>("[data-page-key]");
      if (page?.dataset.pageKey) lastFocused.set(page.dataset.pageKey, e.target as HTMLElement);
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, []);

  useLayoutEffect(() => {
    if (!topKey) return;
    const page = pageOf(topKey);
    if (!page) return;
    // Forget pages that are gone.
    for (const key of lastFocused.keys()) if (!pageOf(key)) lastFocused.delete(key);
    const active = document.activeElement;
    if (active && page.contains(active)) return;
    // Only when focus was in another page (or fell to the body): never steal it from a dialog.
    if (active && active !== document.body && !active.closest("[data-page-key]")) return;
    const back = lastFocused.get(topKey);
    if (back?.isConnected && page.contains(back)) back.focus({ preventScroll: true });
    else {
      if (!page.hasAttribute("tabindex")) page.tabIndex = -1;
      page.focus({ preventScroll: true });
    }
  }, [topKey]);
}
