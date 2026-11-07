// Friends (#135): codes, requests, who is online and in which party, invites.
// Its public surface: code outside src/lib imports this folder, code inside src/lib imports the file.
import { useSyncExternalStore } from "react";
import { backend } from "../account";
import type { FriendPresence } from "../account/backend";
import { createFriends } from "./friends";
import { closePartySurface, openPartySurface, usePartySurface } from "../party/surface";

export * from "./messages";
export { FOLLOW_MAX, INVITE_MS, TRACK_MS, type FriendInvite, type FriendsState, type OwnShown } from "./friends";

export const friends = createFriends({
  friends: () => backend?.friends ?? null,
  now: () => performance.now(),
  after(fn, ms) {
    const t = window.setTimeout(fn, ms);
    return () => window.clearTimeout(t);
  },
});

export const friendsAvailable = () => !!backend;

export function useFriends() {
  return useSyncExternalStore(friends.subscribe, friends.get);
}

// What plays here, for friends who may see it: set by the player while it's open.
let watching: FriendPresence["watching"] | null = null;
const watchers = new Set<() => void>();

export function setWatching(w: FriendPresence["watching"] | null) {
  const same = w && watching ? w.metaId === watching.metaId && w.title === watching.title && w.label === watching.label : w === watching;
  if (same) return;
  watching = w;
  watchers.forEach((l) => l());
}

export function useWatching() {
  return useSyncExternalStore(
    (l) => {
      watchers.add(l);
      return () => void watchers.delete(l);
    },
    () => watching,
  );
}

// The Friends panel (profile menu; TV has its own section on Home): a party surface, one at a time with the others.
export function setFriendsOpen(open: boolean) {
  if (!open) return closePartySurface("friends");
  openPartySurface("friends");
  void friends.refresh();
}

export const useFriendsOpen = () => usePartySurface() === "friends";
