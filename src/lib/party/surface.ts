/**
 * Which watch party surface is up (#247): one at a time, so none can land over another. Opening one
 * closes whichever was up; closing one that isn't up does nothing.
 *
 * - `join`: "Join a Watch Party" (the profile menu's dialog; TV mode's keyboard panel)
 * - `menu`: the party menu (the top bar's popover; TV mode's panel)
 * - `panel`: the player's Watch Party panel
 * - `link`: a link someone put on, shown before it plays here (PartyHost)
 * - `over`: "Watch party over" (removed, or the host ended it)
 * - `friends`: the Friends panel (#135; the profile menu's), where a friend's party is joined
 *
 * The player drawn over the app closes `join`, `menu` and `friends` (PartyHost): a dialog that leads into the
 * player is gone before the player's panel can open. One-time notices that aren't the party's wait
 * while any of these is up (`usePartySurface`). Where each sits on screen is styles/tokens.css's
 * stacking order.
 */
import { useSyncExternalStore } from "react";

export type PartySurface = "join" | "menu" | "panel" | "link" | "over" | "friends";

let current: PartySurface | null = null;
const listeners = new Set<() => void>();

function set(next: PartySurface | null) {
  if (next === current) return;
  current = next;
  listeners.forEach((l) => l());
}

/** Shows `surface`, closing the one that was up. */
export const openPartySurface = (surface: PartySurface) => set(surface);

/** Closes `surface` if it's the one up. */
export function closePartySurface(surface: PartySurface) {
  if (current === surface) set(null);
}

export const getPartySurface = () => current;

export function onPartySurface(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The surface that's up, or null. */
export function usePartySurface() {
  return useSyncExternalStore(onPartySurface, getPartySurface);
}

// The two that predate the rule keep their names.
export const setJoinPartyOpen = (open: boolean) => (open ? openPartySurface("join") : closePartySurface("join"));
export const useJoinPartyOpen = () => usePartySurface() === "join";
export const setPartyMenuOpen = (open: boolean) => (open ? openPartySurface("menu") : closePartySurface("menu"));
export const usePartyMenuOpen = () => usePartySurface() === "menu";
