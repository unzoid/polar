/**
 * The app's side of joining from Discord (#153, #154): the one join desk
 * (discordJoin.ts) for the party this device is in, run while the party can
 * be joined from Discord, and the join a polarity://party link starts.
 *
 * The desk runs while all of these hold (PartyHost decides, see
 * `useJoinDeskWanted`): in a party and let in, Show on Discord on, Who can
 * join from Discord not Nobody, and a Discord-capable build. Out of the party,
 * or any of them off, it stops, and its tokens stop working with it.
 */
import { useSyncExternalStore } from "react";
import { backend } from "../account";
import { askToJoin, createJoinDesk, type AskProgress, type JoinDeps, type JoinDesk, type JoinMode, type JoinRequest } from "./discordJoin";
import { getParty, joinParty } from "./party";
import type { Member } from "./room";

const deps: JoinDeps = {
  connect(topic, onMessage, onReady) {
    const party = backend?.party;
    if (!party) return { send: () => {}, close: () => {} };
    // A channel of its own, next to the room's: nobody is tracked on it, it only carries requests and answers.
    const link = party.connect(
      topic,
      { id: crypto.randomUUID(), name: "", avatar: "", joinedAt: Date.now(), waiting: false },
      { onMessage, onPresence: () => {}, onStatus: (s) => s === "joined" && onReady() },
    );
    return { send: link.send, close: link.close };
  },
  randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
  newId: () => crypto.randomUUID(),
  after(fn, ms) {
    const t = window.setTimeout(fn, ms);
    return () => window.clearTimeout(t);
  },
  subtle: crypto.subtle,
};

// The member's desk.

interface DeskState {
  /** The token the profile's button carries; null: no button. */
  token: string | null;
  requests: JoinRequest[];
}

const NO_DESK: DeskState = { token: null, requests: [] };
let desk: JoinDesk | null = null;
let deskCode: string | null = null;
let mode: JoinMode = "ask";
let snapshot: DeskState = NO_DESK;
const listeners = new Set<() => void>();

function changed() {
  const party = getParty();
  // Locked: nobody can join, so no button either.
  const token = desk && !party?.rules.locked ? desk.token() : null;
  const requests = desk?.requests() ?? [];
  if (token === snapshot.token && requests.length === snapshot.requests.length && requests.every((r, i) => r.id === snapshot.requests[i]?.id)) return;
  snapshot = token || requests.length ? { token, requests } : NO_DESK;
  listeners.forEach((l) => l());
}

/**
 * Runs the desk for party `code` in `joinMode`, or stops it (null). A new
 * code (another party) starts a new desk with new tokens.
 */
export function runJoinDesk(code: string | null, joinMode: JoinMode) {
  mode = joinMode;
  const wanted = code && joinMode !== "nobody" ? code : null;
  if (wanted === deskCode) return changed();
  desk?.stop();
  desk = null;
  deskCode = wanted;
  if (wanted) {
    const d = createJoinDesk(
      deps,
      () => {
        const p = getParty();
        return { code: p && p.code === wanted && !p.knocking ? p.code : null, locked: !!p?.rules.locked };
      },
      () => mode,
    );
    desk = d;
    d.subscribe(changed);
  }
  changed();
}

/** Re-read when the room's rules change (a lock hides the button). */
export const refreshJoinDesk = () => changed();

export const answerJoinRequest = (id: string, allow: boolean) => desk?.answer(id, allow);

export function useJoinDesk() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => snapshot,
  );
}

// Joining from a link.

export interface LinkJoin {
  id: number;
  /** `confirm`: asks first; a link never joins anything by itself. */
  progress: "confirm" | AskProgress | "joining";
  /** The profile name the host will see. */
  name?: string;
  error?: string;
}

let linkJoin: LinkJoin | null = null;
let cancelLinkJoin: (() => void) | null = null;
let confirmed: (() => void) | null = null;
let nextJoin = 1;
const joinListeners = new Set<() => void>();
const setLinkJoin = (next: LinkJoin | null) => {
  linkJoin = next;
  joinListeners.forEach((l) => l());
};

/**
 * A polarity://party link opened: once the user says so (`confirmLinkJoin`),
 * ask its desk, then join the party it hands over. `me` is null when there's
 * no profile to join as (signed out).
 */
export function joinFromLink(token: string, me: Pick<Member, "name" | "avatar"> | null) {
  dismissLinkJoin();
  const id = nextJoin++;
  const fail = (error: string) => setLinkJoin({ id, progress: "asking", error });
  if (!me || !backend) return fail("Sign in to Polarity to join watch parties.");
  if (getParty()) return fail("You're already in a watch party. Leave it first to join another one.");
  setLinkJoin({ id, progress: "confirm", name: me.name });
  confirmed = () => ask(id, token, me);
}

/** "Ask to Join" on a link's question. */
export function confirmLinkJoin() {
  const go = confirmed;
  confirmed = null;
  go?.();
}

function ask(id: number, token: string, me: Pick<Member, "name" | "avatar">) {
  const fail = (error: string) => setLinkJoin({ id, progress: "asking", error });
  const mine = () => linkJoin?.id === id;
  const ask = askToJoin(deps, token, me.name, (progress) => mine() && setLinkJoin({ id, progress }));
  cancelLinkJoin = ask.cancel;
  setLinkJoin({ id, progress: "asking" });
  ask.done
    .then((code) => {
      if (!mine()) return;
      setLinkJoin({ id, progress: "joining" });
      return joinParty(code, me).then(() => mine() && setLinkJoin(null));
    })
    .catch((e: Error) => mine() && e.message !== "cancelled" && fail(e.message));
}

/** Gives up on a join from a link (or closes what it said). */
export function dismissLinkJoin() {
  cancelLinkJoin?.();
  cancelLinkJoin = null;
  confirmed = null;
  setLinkJoin(null);
}

export function useLinkJoin() {
  return useSyncExternalStore(
    (fn) => {
      joinListeners.add(fn);
      return () => void joinListeners.delete(fn);
    },
    () => linkJoin,
  );
}
