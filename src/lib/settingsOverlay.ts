import { useSyncExternalStore } from "react";
import type { PageId } from "../screens/Settings";

/** The settings overlay: open from anywhere, on a given page. */
type State = { open: boolean; page: PageId | null };

let state: State = { open: false, page: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openSettings(page?: string) {
  state = { open: true, page: (page as PageId) ?? state.page };
  emit();
}

export function closeSettings() {
  if (!state.open) return;
  state = { ...state, open: false };
  emit();
}

export const isSettingsOpen = () => state.open;

export function useSettingsOverlay() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
