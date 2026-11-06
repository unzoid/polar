/**
 * A watch-party room, as one member sees it. Built by `createPartyRoom` so
 * the app runs one (party.ts) and tests run several against a simulated
 * server and clock (tests/partySync.test.ts).
 *
 * - The timeline is last-action-wins, ordered by (version, author), so two
 *   people pressing pause at once still end on the same state everywhere.
 * - No shared clock: each message carries its sender's one-way latency
 *   (half the round trip of its own echo) and the receiver adds its own, so
 *   positions are extrapolated to "now" without trusting anyone's system time.
 * - The host (first to have joined) holds the room while anyone is loading,
 *   and answers newcomers. Leaving hands the role to the next.
 * - Leaving the player isn't leaving the room: a member who's browsing is
 *   "away" (not waited for), on every screen. Only Leave Party leaves, and it
 *   says so to the room ("bye"), so nobody has to guess from presence.
 * - Presence can lag or drop an update. Each member numbers its own entries
 *   (`seq`), shows itself as it knows it is, and re-sends its entry when the
 *   room's copy stays out of date. A member missing from presence without a
 *   "bye" is kept for a moment before being shown as gone, so a blip on the
 *   server never splits the room.
 */
import type { PartyLink, PartyPresence } from "../account/backend";
import type { AccountBackend } from "../account/backend";
import { parseMessage, roundTrip, takesOver, type PartyMedia, type Timeline } from "./messages";

export interface Playback extends Timeline {
  /** clock.now() at which `position` was current here. */
  at: number;
}

export type Member = PartyPresence;

export interface PartyNote {
  id: number;
  who: Member | null;
  text: string;
}

export interface PartyState {
  code: string;
  status: "connecting" | "live" | "error";
  /** Set when the room can't work at all (not a dropped connection). */
  error?: string;
  me: string;
  hostId: string | null;
  members: Member[];
  playback: Playback | null;
  notes: PartyNote[];
}

/** Time and timers, so a test can run ten minutes of a party in milliseconds. */
export interface PartyClock {
  /** Monotonic ms, like performance.now(). */
  now(): number;
  /** Wall-clock ms, like Date.now(): only used to agree on an order of joining. */
  wall(): number;
  every(fn: () => void, ms: number): () => void;
  after(fn: () => void, ms: number): () => void;
}

export interface PartyDeps {
  party: () => AccountBackend["party"] | null;
  clock: PartyClock;
  chime: (kind: "join" | "leave") => void;
  /** "Sam jumped to 12:30". */
  formatTime: (seconds: number) => string;
  newId: () => string;
  randomBytes: (n: number) => Uint8Array;
}

/** A waiter the room gives up holding for, so one bad connection can't stall everyone. */
const HOLD_MAX_MS = 30_000;
const HEARTBEAT_MS = 10_000;
const DUTY_MS = 2000;
const JOIN_TIMEOUT_MS = 8000;
const NOTE_MS = 3500;
/** At most one answer to an out-of-date timeline this often. */
const ANSWER_MS = 1000;
/** The room's copy of my entry may lag this long before I send it again. */
export const HEAL_MS = 3000;
/** Missing from presence without a "bye": still shown this long, in case it's a blip. */
export const GONE_MS = 6000;
const NOT_SET_UP = "Watch parties aren't set up on this server yet. Apply the watch_parties migration in Supabase.";
/** No ambiguous characters (0/O, 1/I/L). */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

export type PartyRoom = ReturnType<typeof createPartyRoom>;

export function createPartyRoom(deps: PartyDeps) {
  const { clock } = deps;
  let state: PartyState | null = null;
  let link: PartyLink | null = null;
  let self: Member | null = null;
  let rtts: number[] = [];
  /** The connection's timers and one-off timeouts; all cancelled on leave. */
  const cancels = new Set<() => void>();
  /** Joined, and not yet placed after everyone already in the room (see `presence`). */
  let placeInLine = false;
  const waitingSince = new Map<string, number>();
  let pendingJoin: { resolve: () => void; reject: (e: Error) => void } | null = null;
  let noteId = 0;
  let presenceSeen = false;
  /** The members the server last listed, me as the server has me. */
  let listed: Member[] = [];
  /** Members missing from presence who didn't say bye, and since when. */
  const missing = new Map<string, { member: Member; since: number }>();
  /** Since when the server's copy of my entry has been out of date (or absent). */
  let staleSince: number | null = null;
  /** When we last answered an out-of-date timeline with ours. */
  let lastAnswer = -Infinity;

  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  function later(fn: () => void, ms: number) {
    const cancel = clock.after(() => {
      cancels.delete(cancel);
      fn();
    }, ms);
    cancels.add(cancel);
  }

  function update(patch: Partial<PartyState>) {
    if (!state) return;
    state = { ...state, ...patch };
    emit();
  }

  /** Where the room is right now, extrapolated from the last action. */
  function expectedPosition(p: Playback) {
    return p.paused || p.held ? p.position : p.position + (clock.now() - p.at) / 1000;
  }

  function newCode() {
    const bytes = deps.randomBytes(CODE_LENGTH);
    return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  }

  function myLag() {
    return rtts.length ? Math.min(...rtts) / 2000 : 0.08;
  }

  /** Tell the room how I am now: every entry numbered, so the newest one wins. */
  function track(patch: Partial<Member>) {
    if (!self) return;
    self = { ...self, ...patch, seq: (self.seq ?? 0) + 1 };
    link?.track(self);
    refreshMembers();
  }

  // --- Public --------------------------------------------------------------

  /** Open a room on what's playing now. */
  function startParty(media: PartyMedia, position: number, paused: boolean, me: Pick<Member, "name" | "avatar">) {
    leaveParty();
    const code = newCode();
    // The opener is always first in line to host, whatever the clocks say.
    self = { id: deps.newId(), name: me.name, avatar: me.avatar, joinedAt: 0, waiting: false, seq: 1 };
    state = {
      code,
      status: "connecting",
      me: self.id,
      hostId: self.id,
      members: [self],
      playback: { v: 1, by: self.id, media, paused, held: false, position, lag: 0, at: clock.now() },
      notes: [],
    };
    connect(code);
    emit();
    return code;
  }

  /** Join by code. Resolves once the room's timeline has arrived. */
  function joinParty(input: string, me: Pick<Member, "name" | "avatar">) {
    const code = normalizeCode(input);
    if (code.length !== CODE_LENGTH) return Promise.reject(new Error("Party codes are 6 letters and numbers."));
    if (state?.code === code) return Promise.resolve();
    leaveParty();
    // Waiting from the start: the room holds until this player is up.
    self = { id: deps.newId(), name: me.name, avatar: me.avatar, joinedAt: clock.wall(), waiting: true, seq: 1 };
    state = { code, status: "connecting", me: self.id, hostId: null, members: [self], playback: null, notes: [] };
    const joined = new Promise<void>((resolve, reject) => (pendingJoin = { resolve, reject }));
    connect(code);
    placeInLine = true;
    later(() => failJoin("There's no watch party with that code."), JOIN_TIMEOUT_MS);
    emit();
    return joined;
  }

  /** Leave Party: gone for everyone at once, and the party UI goes away here. */
  function leaveParty() {
    if (self && link) link.send({ t: "bye", from: self.id });
    cancels.forEach((c) => c());
    cancels.clear();
    placeInLine = false;
    link?.close();
    link = null;
    self = null;
    rtts = [];
    listed = [];
    missing.clear();
    staleSince = null;
    waitingSince.clear();
    pendingJoin?.reject(new Error("Left the party."));
    pendingJoin = null;
    if (state) {
      state = null;
      emit();
    }
  }

  /** A change made here: becomes the room's newest timeline. */
  function partyAct(patch: Partial<Pick<Timeline, "media" | "paused" | "held" | "position">>) {
    const cur = state?.playback;
    if (!state || !self || !cur) return;
    const next: Timeline = {
      v: cur.v + 1,
      by: self.id,
      media: patch.media ?? cur.media,
      paused: patch.paused ?? cur.paused,
      held: patch.held ?? cur.held,
      position: patch.position ?? expectedPosition(cur),
      lag: myLag(),
    };
    update({ playback: { ...next, at: clock.now() } });
    link?.send({ t: "state", from: self.id, tl: next });
    hostDuty();
  }

  /** Loading the room's video: the host holds the room until this clears. */
  function setPartyWaiting(waiting: boolean) {
    if (self && self.waiting !== waiting) track({ waiting });
  }

  /** Stalled mid-video: shown to the others, but the room doesn't hold for it. */
  function setPartyBuffering(buffering: boolean) {
    if (self && !!self.buffering !== buffering) track({ buffering });
  }

  /** Out of the player (or back in it): still in the room, which carries on without waiting. */
  function setPartyAway(away: boolean) {
    if (!self || !!self.away === away) return;
    track(away ? { away, waiting: false, buffering: false } : { away });
  }

  // --- Internals -----------------------------------------------------------

  function connect(code: string) {
    const party = deps.party();
    if (!party || !self) return;
    presenceSeen = false;
    link = party.connect(code, self, {
      onMessage: receive,
      onPresence: presence,
      onStatus: (s, detail) => {
        if (s === "error") {
          const message = detail?.setup ? NOT_SET_UP : "Couldn't reach the watch party. Check your connection.";
          if (pendingJoin) return failJoin(message);
          // Refused outright: retrying can't help, so stop and say why.
          if (detail?.setup) {
            link?.close();
            link = null;
          }
          update({ status: "error", error: detail?.setup ? NOT_SET_UP : undefined });
          return;
        }
        update({ status: "live", error: undefined });
        ping();
        // Ask for the timeline (again, after a reconnect: messages may have been missed).
        if (self) link?.send({ t: "hello", from: self.id });
      },
    });
    cancels.add(clock.every(ping, HEARTBEAT_MS));
    cancels.add(clock.every(heartbeat, HEARTBEAT_MS));
    cancels.add(clock.every(duty, DUTY_MS));
  }

  function failJoin(message: string) {
    const p = pendingJoin;
    if (!p) return;
    pendingJoin = null;
    leaveParty();
    p.reject(new Error(message));
  }

  function ping() {
    if (self) link?.send({ t: "ping", from: self.id, sent: clock.now() });
  }

  /** The host re-sends the timeline now and then, so a missed message heals. */
  function heartbeat() {
    if (state && self && state.hostId === self.id) sendTimeline();
  }

  function sendTimeline() {
    const p = state?.playback;
    if (!p || !self) return;
    const { at: _at, ...tl } = p;
    link?.send({ t: "state", from: self.id, tl: { ...tl, position: expectedPosition(p), lag: myLag() } });
  }

  function receive(raw: Record<string, unknown>) {
    if (!state || !self) return;
    const msg = parseMessage(raw);
    if (!msg) return;
    const from = msg.from;
    switch (msg.t) {
      case "ping": {
        const rtt = from === self.id ? roundTrip(msg.sent, clock.now()) : undefined;
        if (rtt !== undefined) rtts = [...rtts.slice(-4), rtt];
        return;
      }
      case "hello":
        // Whoever has the timeline answers; ties resolve themselves (same version).
        if (from !== self.id) sendTimeline();
        return;
      case "bye": {
        if (from === self.id) return;
        const who = state.members.find((m) => m.id === from);
        listed = listed.filter((m) => m.id !== from);
        missing.delete(from);
        if (who) {
          note(who, "left");
          deps.chime("leave");
        }
        refreshMembers();
        return;
      }
      case "state": {
        if (from === self.id) return; // applied when it was made
        const tl = msg.tl;
        const cur = state.playback;
        if (!takesOver(cur, tl, presenceSeen ? state.members : null, state.hostId)) {
          // The sender missed our newer action (a dropped message): send ours, or each
          // side would follow its own timeline from here on, the host's heartbeat included.
          const ahead = cur && (cur.v > tl.v || (cur.v === tl.v && cur.by > tl.by));
          if (ahead && clock.now() - lastAnswer >= ANSWER_MS) {
            lastAnswer = clock.now();
            sendTimeline();
          }
          return;
        }
        const next: Playback = { ...tl, at: clock.now() - (tl.lag + myLag()) * 1000 };
        if (cur && (tl.v !== cur.v || tl.by !== cur.by)) describe(cur, next);
        update({ playback: next });
        if (pendingJoin) {
          pendingJoin.resolve();
          pendingJoin = null;
        }
        hostDuty();
        return;
      }
    }
  }

  function presence(list: Member[]) {
    if (!state || !self) return;
    // Who hosts next goes by `joinedAt`. Each member's clock sets its own, and clocks
    // differ, so on joining take the place after everyone already there instead.
    if (placeInLine) {
      placeInLine = false;
      const last = Math.max(0, ...list.filter((m) => m.id !== self!.id).map((m) => m.joinedAt));
      if (self.joinedAt <= last) track({ joinedAt: last + 1 });
    }
    const now = clock.now();
    const before = new Map(listed.map((m) => [m.id, m]));
    const after = new Set(list.map((m) => m.id));
    // The first list is who was already there: not news.
    if (presenceSeen) {
      const joined = list.filter((m) => !before.has(m.id) && !missing.has(m.id) && m.id !== self!.id);
      joined.forEach((m) => note(m, "joined"));
      if (joined.length) deps.chime("join");
      // Gone without a bye: wait a moment before believing it.
      for (const m of listed) if (!after.has(m.id) && m.id !== self.id && !missing.has(m.id)) missing.set(m.id, { member: m, since: now });
    }
    for (const id of after) missing.delete(id);
    presenceSeen = true;
    listed = list;
    refreshMembers();
    hostDuty();
  }

  /**
   * Who's in, as everyone should see it: the server's list, me as I am (not
   * as its copy may still have me), and anyone briefly missing. Notes whether
   * the server's copy of me is behind, for `duty` to send it again.
   */
  function refreshMembers() {
    if (!state || !self) return;
    const me = self;
    const mine = listed.find((m) => m.id === me.id);
    const fresh = !!mine && (mine.seq ?? 0) >= (me.seq ?? 0);
    if (!presenceSeen || fresh) staleSince = null;
    else staleSince ??= clock.now();
    const others = listed.filter((m) => m.id !== me.id && !missing.has(m.id));
    const members = [...others, ...[...missing.values()].map((x) => x.member), me].sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
    // The host is the first who is really there: not someone presence has lost.
    const hostId = members.find((m) => !missing.has(m.id))?.id ?? null;
    update({ members, hostId });
  }

  /** Every couple of seconds: mend my entry, give up on the missing, hold or release the room. */
  function duty() {
    if (!state || !self) return;
    const now = clock.now();
    if (staleSince != null && now - staleSince >= HEAL_MS && link) {
      staleSince = now;
      link.track(self);
    }
    let gone = false;
    for (const [id, { member, since }] of missing) {
      if (now - since < GONE_MS) continue;
      missing.delete(id);
      note(member, "left");
      gone = true;
    }
    if (gone) {
      deps.chime("leave");
      refreshMembers();
    }
    hostDuty();
  }

  /** Host: hold the room while anyone (not given up on) is loading. */
  function hostDuty() {
    const p = state?.playback;
    if (!state || !self || !p || state.hostId !== self.id) return;
    const now = clock.wall();
    for (const m of state.members) {
      if (m.waiting && !m.away && !missing.has(m.id)) waitingSince.set(m.id, waitingSince.get(m.id) ?? now);
      else waitingSince.delete(m.id);
    }
    for (const id of waitingSince.keys()) if (!state.members.some((m) => m.id === id)) waitingSince.delete(id);
    const hold = state.members.some((m) => waitingSince.has(m.id) && now - waitingSince.get(m.id)! < HOLD_MAX_MS);
    if (hold !== p.held) partyAct({ held: hold });
  }

  /** "Sam paused", "Sam jumped to 12:30" — for actions by others. */
  function describe(prev: Playback, next: Playback) {
    if (next.held !== prev.held) return; // the host holding, not anyone's action
    const who = state?.members.find((m) => m.id === next.by) ?? null;
    if (prev.media.videoId !== next.media.videoId) return note(who, next.media.label ? `put on ${next.media.label}` : "changed what's playing");
    if (JSON.stringify(prev.media) !== JSON.stringify(next.media)) return; // filled in the label or stream hint
    if (prev.paused !== next.paused) return note(who, next.paused ? "paused" : "resumed");
    if (Math.abs(next.position - expectedPosition(prev)) > 3) note(who, `jumped to ${deps.formatTime(next.position)}`);
  }

  function note(who: Member | null, text: string) {
    if (!state) return;
    const n = { id: ++noteId, who, text };
    update({ notes: [...state.notes.slice(-2), n] });
    later(() => state && update({ notes: state.notes.filter((x) => x.id !== n.id) }), NOTE_MS);
  }

  return {
    getParty: () => state,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    expectedPosition,
    /** The room's position for this video, if the room is on it. */
    partyPosition(videoId: string) {
      const p = state?.playback;
      return p && p.media.videoId === videoId ? expectedPosition(p) : undefined;
    },
    startParty,
    joinParty,
    leaveParty,
    partyAct,
    setPartyWaiting,
    setPartyBuffering,
    setPartyAway,
  };
}

export function normalizeCode(input: string) {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, CODE_LENGTH);
}

export type MemberStatus = "Away" | "Loading" | "Buffering" | "Paused" | "Watching";

/** What a member is doing, worded the same on every screen. */
export function memberStatus(m: Member, playback: Playback | null): MemberStatus {
  if (m.away) return "Away";
  if (m.waiting) return "Loading";
  if (m.buffering) return "Buffering";
  return playback?.paused ? "Paused" : "Watching";
}
