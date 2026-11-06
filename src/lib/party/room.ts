/**
 * A watch-party room, as one member sees it. Built by `createPartyRoom` so
 * the app runs one (party.ts) and tests run several against a simulated
 * server and clock (tests/partySync.test.ts, tests/partyMenu.test.ts).
 *
 * - The timeline is last-action-wins, ordered by (version, author), so two
 *   people pressing pause at once still end on the same state everywhere.
 * - No shared clock: each message carries its sender's one-way latency
 *   (half the round trip of its own echo) and the receiver adds its own, so
 *   positions are extrapolated to "now" without trusting anyone's system time.
 * - The host (first to have joined, or whoever it handed the role to) holds
 *   the room while anyone is loading, answers newcomers and sets the room's
 *   rules (#156): locked, who controls playback, waiting, approving joins,
 *   who's been removed. Leaving hands the role to the next in line.
 * - A joiner knocks first: it isn't shown or listened to until the host lets
 *   it in, which the host does at once unless the room is locked or asks it
 *   to approve joins. There's no server of our own, so the rules hold because
 *   every member's app keeps them (see messages.ts).
 * - Leaving the player isn't leaving the room: a member who's browsing is
 *   "away" (not waited for), on every screen. Only Leave Party leaves, and it
 *   says so to the room ("bye"), so nobody has to guess from presence.
 * - Presence can lag or drop an update. Each member numbers its own entries
 *   (`seq`), shows itself as it knows it is, and re-sends its entry when the
 *   room's copy stays out of date. A member missing from presence without a
 *   "bye" is kept for a moment (as Disconnected) before being shown as gone,
 *   so a blip on the server never splits the room.
 */
import type { PartyLink, PartyPresence } from "../account/backend";
import type { AccountBackend } from "../account/backend";
import { DEFAULT_RULES, OUT_MAX, parseMessage, roundTrip, takesOver, type PartyMedia, type Refusal, type RoomRules, type Timeline } from "./messages";

export interface Playback extends Timeline {
  /** clock.now() at which `position` was current here. */
  at: number;
}

export type Member = PartyPresence & {
  /** Missing from presence without having said bye: maybe back in a moment. */
  lost?: boolean;
};

export interface PartyNote {
  id: number;
  /** Who did it, if we know. */
  who: Member | null;
  text: string;
  /** The room speaking, not a member ("Only the host controls playback"): shown as the text alone. */
  system?: boolean;
}

/** Where a member's player said it was. */
export interface MemberPosition {
  videoId: string;
  position: number;
  paused: boolean;
  /** clock.now() at which `position` was current here. */
  at: number;
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
  rules: RoomRules;
  /** Joined, and waiting for the host to let me in. */
  knocking: boolean;
  /** Joiners waiting for the host to let them in (only the host can). */
  knockers: Member[];
  positions: Record<string, MemberPosition>;
  /** No chimes, no "joined"/"left" notes. */
  quiet: boolean;
  /** Counts Sync now presses: the player re-seeks to the room on each. */
  resync: number;
}

/** Why the party ended here, other than by Leave Party. */
export interface PartyExit {
  id: number;
  text: string;
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
/** Further behind the room than this is worth showing ("4 s behind"). */
export const BEHIND_SHOWN = 2;
const NOT_SET_UP = "Watch parties aren't set up on this server yet. Apply the watch_parties migration in Supabase.";
const REFUSED: Record<Refusal, string> = {
  locked: "This watch party is locked. Ask the host to unlock it.",
  denied: "The host didn't let you in.",
};
export const KICKED = "The host removed you from the watch party.";
export const ENDED = "The host ended the watch party.";
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
  let cancelJoinTimeout: (() => void) | null = null;
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
  /** Host: joiners answered (let in or turned away), and when, so a lost answer is sent again. */
  const answered = new Map<string, { at: number; refuse?: Refusal }>();
  /** Kept from one party to the next. */
  let quiet = false;
  let exit: PartyExit | null = null;
  let exitId = 0;
  /** Who set the rules we have: of two hosts' rules with the same version, the higher id's win everywhere. */
  let rulesBy = "";
  /** When "only the host controls playback" was last said here, so it's said once per try, not per event. */
  let lastControlNote = -Infinity;

  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  function later(fn: () => void, ms: number) {
    const cancel = clock.after(() => {
      cancels.delete(cancel);
      fn();
    }, ms);
    cancels.add(cancel);
    return () => {
      cancels.delete(cancel);
      cancel();
    };
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

  const isHost = () => !!state && !!self && !state.knocking && state.hostId === self.id;

  function fresh(code: string, me: Member, patch: Partial<PartyState> = {}): PartyState {
    return {
      code,
      status: "connecting",
      me: me.id,
      hostId: null,
      members: [me],
      playback: null,
      notes: [],
      rules: DEFAULT_RULES,
      knocking: false,
      knockers: [],
      positions: {},
      quiet,
      resync: 0,
      ...patch,
    };
  }

  // --- Public --------------------------------------------------------------

  /** Open a room on what's playing now. */
  function startParty(media: PartyMedia, position: number, paused: boolean, me: Pick<Member, "name" | "avatar">) {
    leaveParty();
    const code = newCode();
    // The opener is always first in line to host, whatever the clocks say.
    self = { id: deps.newId(), name: me.name, avatar: me.avatar, joinedAt: 0, waiting: false, seq: 1 };
    state = fresh(code, self, {
      hostId: self.id,
      playback: { v: 1, by: self.id, media, paused, held: false, position, lag: 0, at: clock.now() },
      rules: { ...DEFAULT_RULES, v: 1 },
    });
    rulesBy = self.id;
    connect(code);
    emit();
    return code;
  }

  /**
   * Join by code. Resolves once the host has let me in and the room's
   * timeline has arrived; while the host decides, `knocking` is set.
   */
  function joinParty(input: string, me: Pick<Member, "name" | "avatar">) {
    const code = normalizeCode(input);
    if (code.length !== CODE_LENGTH) return Promise.reject(new Error("Party codes are 6 letters and numbers."));
    if (state?.code === code) return Promise.resolve();
    leaveParty();
    // Waiting from the start: the room holds until this player is up.
    self = { id: deps.newId(), name: me.name, avatar: me.avatar, joinedAt: clock.wall(), waiting: true, knock: true, seq: 1 };
    state = fresh(code, self, { knocking: true });
    const joined = new Promise<void>((resolve, reject) => (pendingJoin = { resolve, reject }));
    connect(code);
    placeInLine = true;
    cancelJoinTimeout = later(() => failJoin("There's no watch party with that code."), JOIN_TIMEOUT_MS);
    emit();
    return joined;
  }

  /** Leave Party: gone for everyone at once, and the party UI goes away here. */
  function leaveParty() {
    if (self && link) link.send({ t: "bye", from: self.id });
    cancels.forEach((c) => c());
    cancels.clear();
    cancelJoinTimeout = null;
    placeInLine = false;
    link?.close();
    link = null;
    self = null;
    rtts = [];
    listed = [];
    missing.clear();
    staleSince = null;
    waitingSince.clear();
    answered.clear();
    rulesBy = "";
    pendingJoin?.reject(new Error("Left the party."));
    pendingJoin = null;
    if (state) {
      state = null;
      emit();
    }
  }

  /** Out of the party for a reason the viewer is told about (removed, ended). */
  function exitWith(text: string) {
    leaveParty();
    exit = { id: ++exitId, text };
    emit();
  }

  /**
   * A change made here: becomes the room's newest timeline. False when it
   * can't (only the host controls playback, or not let in yet), and the
   * player goes back to the room's.
   */
  function partyAct(patch: Partial<Pick<Timeline, "media" | "paused" | "held" | "position">>) {
    const cur = state?.playback;
    if (!state || !self || !cur || state.knocking) return false;
    if (state.rules.control === "host" && state.hostId !== self.id) {
      const tried = patch.paused !== undefined || patch.position !== undefined || (patch.media && patch.media.videoId !== cur.media.videoId);
      if (tried && clock.now() - lastControlNote > NOTE_MS) {
        lastControlNote = clock.now();
        note(null, "Only the host controls playback in this party.", true);
      }
      return false;
    }
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
    return true;
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

  /** Where this player is, now and then, so the others can see who's fallen behind. */
  function reportPosition(videoId: string, position: number, paused: boolean) {
    if (!self || !state || state.knocking) return;
    link?.send({ t: "at", from: self.id, videoId, position, paused, lag: myLag() });
  }

  /** Seconds this member is behind the room, if it's on the room's video and far enough behind to say. */
  function behind(id: string) {
    const p = state?.playback;
    const at = state?.positions[id];
    if (!p || !at || at.videoId !== p.media.videoId) return undefined;
    const theirs = at.paused || p.paused || p.held ? at.position : at.position + (clock.now() - at.at) / 1000;
    const gap = expectedPosition(p) - theirs;
    return gap > BEHIND_SHOWN ? gap : undefined;
  }

  /** Sync now: the player here re-seeks to where the room is. */
  function syncNow() {
    if (state) update({ resync: state.resync + 1 });
  }

  function setQuiet(on: boolean) {
    quiet = on;
    update({ quiet });
  }

  /** Host: change how the room runs. Everyone takes the new rules. */
  function setRules(patch: Partial<Omit<RoomRules, "v">>) {
    if (!state || !self || !isHost()) return;
    const rules = { ...state.rules, ...patch, v: state.rules.v + 1 };
    rulesBy = self.id;
    update({ rules });
    sendRules();
    refreshMembers();
    hostDuty();
  }

  /** Host: hand the role to another member. */
  function makeHost(id: string) {
    if (state?.members.some((m) => m.id === id && !m.lost)) setRules({ host: id });
  }

  /** Host: remove a member. It's told why; the others stop seeing and hearing it. */
  function kick(id: string) {
    if (!state || !self || !isHost() || id === self.id) return;
    const who = state.members.find((m) => m.id === id);
    link?.send({ t: "kick", from: self.id, to: id });
    setRules({ out: [...state.rules.out.filter((o) => o !== id), id].slice(-OUT_MAX) });
    if (who) note(who, "was removed");
  }

  /** Host: let a waiting joiner in. */
  function admit(id: string) {
    if (!self || !isHost()) return;
    answered.set(id, { at: clock.now() });
    link?.send({ t: "admit", from: self.id, to: id });
  }

  /** Host: turn a waiting joiner away. */
  function deny(id: string) {
    if (!self || !isHost()) return;
    answered.set(id, { at: clock.now(), refuse: "denied" });
    link?.send({ t: "refuse", from: self.id, to: id, why: "denied" });
    refreshMembers();
  }

  /** Host: the party is over, for everyone. */
  function endParty() {
    if (!self || !isHost()) return;
    link?.send({ t: "end", from: self.id });
    leaveParty();
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

  /** In, with the room's timeline: the join is done. */
  function joined() {
    if (!pendingJoin || !state || state.knocking || !state.playback) return;
    pendingJoin.resolve();
    pendingJoin = null;
  }

  function letIn() {
    if (!state?.knocking) return;
    cancelJoinTimeout?.();
    cancelJoinTimeout = null;
    update({ knocking: false });
    track({ knock: false });
    joined();
  }

  function ping() {
    if (self) link?.send({ t: "ping", from: self.id, sent: clock.now() });
  }

  /** The host re-sends the rules and timeline now and then, so a missed message heals. */
  function heartbeat() {
    if (isHost()) {
      sendRules();
      sendTimeline();
    }
  }

  function sendRules() {
    if (state && self && state.rules.v > 0) link?.send({ t: "rules", from: self.id, rules: state.rules });
  }

  function sendTimeline() {
    const p = state?.playback;
    if (!p || !self) return;
    const { at: _at, ...tl } = p;
    link?.send({ t: "state", from: self.id, tl: { ...tl, position: expectedPosition(p), lag: myLag() } });
  }

  /** Someone the room listens to: in, let in, and not removed. */
  function inRoom(id: string) {
    return !!state?.members.some((m) => m.id === id);
  }

  function receive(raw: Record<string, unknown>) {
    if (!state || !self) return;
    const msg = parseMessage(raw);
    if (!msg) return;
    const from = msg.from;
    // Removed members aren't heard, whatever they send.
    if (state.rules.out.includes(from) && from !== self.id) return;
    switch (msg.t) {
      case "ping": {
        const rtt = from === self.id ? roundTrip(msg.sent, clock.now()) : undefined;
        if (rtt !== undefined) rtts = [...rtts.slice(-4), rtt];
        return;
      }
      case "hello":
        // Whoever has the timeline answers, the rules first (a joiner tells from them
        // that it has to be let in); ties resolve themselves (same version).
        if (from !== self.id && !state.knocking) {
          sendRules();
          sendTimeline();
        }
        return;
      case "bye": {
        if (from === self.id) return;
        const who = state.members.find((m) => m.id === from);
        listed = listed.filter((m) => m.id !== from);
        missing.delete(from);
        if (who && !state.quiet) {
          note(who, "left");
          deps.chime("leave");
        }
        refreshMembers();
        return;
      }
      case "rules": {
        const cur = state.rules;
        const rules = msg.rules;
        if (rules.v < cur.v || (rules.v === cur.v && from <= rulesBy)) return;
        // From the host, or from whoever the rules name as host; a joiner with none yet takes the first.
        const fromHost = from === state.hostId || from === rules.host || cur.v === 0;
        if (!fromHost || (presenceSeen && !inRoom(from) && from !== self.id)) return;
        if (rules.out.includes(self.id)) return exitWith(KICKED);
        const removed = state.members.filter((m) => rules.out.includes(m.id) && !cur.out.includes(m.id));
        rulesBy = from;
        update({ rules });
        if (state.knocking) {
          // The host turns joiners away only by message, but nobody's waiting on a locked room's timer.
          if (rules.approve) {
            cancelJoinTimeout?.();
            cancelJoinTimeout = null;
          }
        }
        removed.forEach((m) => note(m, "was removed by the host"));
        refreshMembers();
        hostDuty();
        return;
      }
      case "admit":
        if (msg.to === self.id && inRoom(from) && from !== self.id) letIn();
        return;
      case "refuse":
        if (msg.to === self.id && state.knocking && inRoom(from) && from !== self.id) failJoin(REFUSED[msg.why]);
        return;
      case "kick":
        if (msg.to === self.id && from === state.hostId && from !== self.id) exitWith(KICKED);
        return;
      case "end":
        if (from === state.hostId && from !== self.id) exitWith(ENDED);
        return;
      case "at": {
        if (!inRoom(from)) return;
        const at = clock.now() - (msg.lag + myLag()) * 1000;
        update({ positions: { ...state.positions, [from]: { videoId: msg.videoId, position: msg.position, paused: msg.paused, at } } });
        return;
      }
      case "state": {
        if (from === self.id) return; // applied when it was made
        const tl = msg.tl;
        const cur = state.playback;
        if (!takesOver(cur, tl, presenceSeen ? state.members : null, state.hostId, state.rules.control === "host")) {
          // The sender missed our newer action (a dropped message): send ours, or each
          // side would follow its own timeline from here on, the host's heartbeat included.
          const ahead = cur && (cur.v > tl.v || (cur.v === tl.v && cur.by > tl.by));
          if (ahead && !state.knocking && clock.now() - lastAnswer >= ANSWER_MS) {
            lastAnswer = clock.now();
            sendTimeline();
          }
          return;
        }
        const next: Playback = { ...tl, at: clock.now() - (tl.lag + myLag()) * 1000 };
        if (cur && (tl.v !== cur.v || tl.by !== cur.by)) describe(cur, next);
        update({ playback: next });
        // A room with no rules is on an app from before joins were answered: in already.
        if (state.knocking && state.rules.v === 0) letIn();
        joined();
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
    const out = state.rules.out;
    // The first list is who was already there: not news. A knocker is news once let in.
    if (presenceSeen) {
      const wasIn = (id: string) => !!before.get(id) && !before.get(id)!.knock;
      const joined = list.filter((m) => !m.knock && !wasIn(m.id) && !missing.has(m.id) && m.id !== self!.id && !out.includes(m.id));
      if (!state.quiet) {
        joined.forEach((m) => note(m, "joined"));
        if (joined.length) deps.chime("join");
      }
      // Gone without a bye: wait a moment before believing it.
      for (const m of listed) if (!after.has(m.id) && !m.knock && m.id !== self.id && !missing.has(m.id)) missing.set(m.id, { member: m, since: now });
    }
    for (const id of after) missing.delete(id);
    presenceSeen = true;
    listed = list;
    refreshMembers();
    hostDuty();
  }

  /**
   * Who's in, as everyone should see it: the server's list, me as I am (not
   * as its copy may still have me), and anyone briefly missing (as lost).
   * Joiners not yet let in and removed members aren't in it. Notes whether
   * the server's copy of me is behind, for `duty` to send it again.
   */
  function refreshMembers() {
    if (!state || !self) return;
    const me = self;
    const mine = listed.find((m) => m.id === me.id);
    const upToDate = !!mine && (mine.seq ?? 0) >= (me.seq ?? 0);
    if (!presenceSeen || upToDate) staleSince = null;
    else staleSince ??= clock.now();
    const out = state.rules.out;
    const others = listed.filter((m) => m.id !== me.id && !missing.has(m.id) && !out.includes(m.id));
    const lost = [...missing.values()].filter((x) => !out.includes(x.member.id)).map((x) => ({ ...x.member, lost: true }));
    const members = [...others.filter((m) => !m.knock), ...lost, me].sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
    const knockers = others.filter((m) => m.knock && answered.get(m.id)?.refuse === undefined);
    // The host is whoever it handed the role to, while really there; else the first who is.
    const present = members.filter((m) => !m.lost && !m.knock);
    const named = state.rules.host ? present.find((m) => m.id === state!.rules.host) : undefined;
    const hostId = (named ?? present[0])?.id ?? null;
    const before = state.hostId;
    update({ members, knockers, hostId });
    if (presenceSeen && before && hostId && before !== hostId) {
      const who = members.find((m) => m.id === hostId) ?? null;
      note(who, "is now the host");
    }
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
      if (!state.quiet && !state.rules.out.includes(id)) note(member, "left");
      gone = true;
    }
    if (gone) {
      if (!state.quiet) deps.chime("leave");
      refreshMembers();
    }
    hostDuty();
  }

  /**
   * Host: keep the rules naming the actual host, answer joiners, and hold the
   * room while anyone (not given up on) is loading, if the room waits.
   */
  function hostDuty() {
    const p = state?.playback;
    if (!state || !self || !p || !isHost()) return;
    // Hosting because the named host left: say so in the rules, so everyone agrees.
    if (state.rules.host && state.rules.host !== self.id) return setRules({ host: self.id });
    const clockNow = clock.now();
    // Joiners still knocking, those turned away for a lock included: a lost answer is sent again.
    const knocking = listed.filter((m) => m.knock && !state!.rules.out.includes(m.id) && answered.get(m.id)?.refuse !== "denied");
    for (const k of knocking) {
      const a = answered.get(k.id);
      if (a && clockNow - a.at < DUTY_MS) continue; // answered; again if it's still knocking
      if (state.rules.locked) {
        answered.set(k.id, { at: clockNow, refuse: "locked" });
        link?.send({ t: "refuse", from: self.id, to: k.id, why: "locked" });
      } else if (a || !state.rules.approve) admit(k.id);
    }
    const now = clock.wall();
    for (const m of state.members) {
      if (state.rules.wait && m.waiting && !m.away && !m.lost) waitingSince.set(m.id, waitingSince.get(m.id) ?? now);
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

  function note(who: Member | null, text: string, system = false) {
    if (!state) return;
    const n: PartyNote = system ? { id: ++noteId, who, text, system } : { id: ++noteId, who, text };
    update({ notes: [...state.notes.slice(-2), n] });
    later(() => state && update({ notes: state.notes.filter((x) => x.id !== n.id) }), NOTE_MS);
  }

  return {
    getParty: () => state,
    getExit: () => exit,
    /** The viewer has read why the party ended. */
    dismissExit() {
      if (!exit) return;
      exit = null;
      emit();
    },
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
  };
}

export function normalizeCode(input: string) {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, CODE_LENGTH);
}

export type MemberStatus = "Disconnected" | "Away" | "Loading" | "Buffering" | "Paused" | "Watching";

/** What a member is doing, worded the same on every screen. */
export function memberStatus(m: Member, playback: Playback | null): MemberStatus {
  if (m.lost) return "Disconnected";
  if (m.away) return "Away";
  if (m.waiting) return "Loading";
  if (m.buffering) return "Buffering";
  return playback?.paused ? "Paused" : "Watching";
}
