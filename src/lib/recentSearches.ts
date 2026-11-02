import { useSyncExternalStore } from "react";
import { getPrefs } from "./prefs";

/** The last few searches you ran (pressed Enter on, or opened a result from), newest first. Kept on this machine. */
const KEY = "polar.recentSearches";
const MAX = 5;

let recent: string[] = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((s): s is string => typeof s === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
})();
const listeners = new Set<() => void>();

function save(next: string[]) {
  recent = next;
  localStorage.setItem(KEY, JSON.stringify(next));
  listeners.forEach((l) => l());
}

export function addRecentSearch(query: string) {
  const q = query.trim();
  if (q.length < 2 || !getPrefs().saveRecentSearches) return;
  // The same search again moves to the top rather than appearing twice.
  const rest = recent.filter((s) => s.toLowerCase() !== q.toLowerCase());
  if (recent[0] === q) return;
  save([q, ...rest].slice(0, MAX));
}

export const clearRecentSearches = () => save([]);

export function useRecentSearches() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => recent,
  );
}
