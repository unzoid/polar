/**
 * The app's watch party: one room (room.ts) on the account backend's
 * Realtime channels, the browser's clock, and the hooks the UI reads it with.
 *
 * Stream URLs never leave the device (add-on links can carry API keys): only
 * a hint — the release name — so others pick the same file from their own
 * add-ons.
 */
import { useSyncExternalStore } from "react";
import { backend } from "../account";
import { formatTime } from "../format";
import { createPartyRoom, type PartyClock } from "./room";
import { partyChime } from "./sounds";
import type { StreamHint } from "./messages";
import type { Stream } from "../types";

export type { PartyMedia, StreamHint } from "./messages";
export {
  BEHIND_SHOWN,
  CODE_LENGTH,
  memberStatus,
  normalizeCode,
  type Member,
  type MemberPosition,
  type MemberStatus,
  type PartyExit,
  type PartyNote,
  type PartyState,
  type Playback,
} from "./room";

const browserClock: PartyClock = {
  now: () => performance.now(),
  wall: () => Date.now(),
  every(fn, ms) {
    const t = window.setInterval(fn, ms);
    return () => window.clearInterval(t);
  },
  after(fn, ms) {
    const t = window.setTimeout(fn, ms);
    return () => window.clearTimeout(t);
  },
};

const room = createPartyRoom({
  party: () => backend?.party ?? null,
  clock: browserClock,
  chime: partyChime,
  formatTime,
  newId: () => crypto.randomUUID(),
  randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
});

export const {
  getParty,
  expectedPosition,
  partyPosition,
  startParty,
  joinParty,
  leaveParty,
  partyAct,
  setPartyWaiting,
  setPartyBuffering,
  setPartyAway,
  reportPosition,
  behind,
  syncNow,
  setQuiet,
  setRules,
  makeHost,
  kick,
  admit,
  deny,
  endParty,
  dismissExit,
} = room;

export const partyAvailable = () => !!backend;

export function useParty() {
  return useSyncExternalStore(room.subscribe, room.getParty);
}

/** Why the party ended here (removed, ended by the host), until the viewer has read it. */
export function usePartyExit() {
  return useSyncExternalStore(room.subscribe, room.getExit);
}

/** What others need to find the same file, without the URL itself. */
export function streamHint(s?: Stream): StreamHint | undefined {
  if (!s) return undefined;
  const release = (s.title ?? s.description ?? "").split("\n")[0].trim() || undefined;
  return release ? { release } : undefined;
}

export function sameFile(s: Stream, hint: StreamHint) {
  const h = streamHint(s);
  return !!h && !!hint.release && hint.release.toLowerCase() === h.release?.toLowerCase();
}

// --- Join sheet (opened from the profile menu) -------------------------------

let joinOpen = false;
const joinListeners = new Set<() => void>();
export function setJoinPartyOpen(open: boolean) {
  joinOpen = open;
  joinListeners.forEach((l) => l());
}
export function useJoinPartyOpen() {
  return useSyncExternalStore(
    (l) => {
      joinListeners.add(l);
      return () => joinListeners.delete(l);
    },
    () => joinOpen,
  );
}
