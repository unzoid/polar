import { useSyncExternalStore } from "react";

/**
 * The search text, shared between the navbar's search field (where you type)
 * and the Search page (which shows results for it).
 */
let text = "";
const listeners = new Set<() => void>();

export function setSearchText(next: string) {
  if (next === text) return;
  text = next;
  listeners.forEach((l) => l());
}

export function useSearchText() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => text,
  );
}

/** Asks the navbar to open and focus its search field (Ctrl K, "/"). */
export const FOCUS_SEARCH_EVENT = "polar:focus-search";
export const focusSearch = () => window.dispatchEvent(new Event(FOCUS_SEARCH_EVENT));
