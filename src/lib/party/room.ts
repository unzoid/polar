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
 * - Presence isn't the only sign of life (#203): everyone pings every few
 *   seconds, so a member heard from lately is shown as connected whatever
 *   presence says, and is asked to send its entry again until presence agrees.
 *   A member whose own pings stop coming back reconnects by itself.
 * - Presence updates are rationed (#227): the server closes the channel of a
 *   client that sends more than 5 in 30 s, and a closed channel still sends
 *   (broadcasts fall back to REST) but hears nothing. A change of status waits
 *   a moment for the next, so a burst goes as one update, and no more than
 *   PRESENCE_MAX go out per PRESENCE_WINDOW_MS, joins included. A channel the
 *   server closes anyway is opened again at once.
 * - The host has the last word on the timeline: a member's change the host
 *   refuses (it doesn't count the member as in the room) is answered with the
 *   host's, marked as refusing it, and the member goes back to the host's.
 * - Every device keeps a party log (log.ts) for "Copy party log".
 */
import type { PartyLink, PartyPresence } from "../account/backend";
import type { AccountBackend } from "../account/backend";
import { createPartyLog, tag } from "./log";
import { DEFAULT_RULES, OUT_MAX, parseMessage, roundTrip, takesOver, V_JUMP_MAX, type PartyMedia, type PartyMessage, type Refusal, type RoomRules, type Timeline } from "./messages";

export interface Playback extends Timeline {
  /** clock.now() at which `position` was current here. */
  at: number;
}

export type Member = PartyPresence & {
  /** Missing from presence without having said bye: maybe back in a moment. */
  lost?: boolean;
  /** Missing from presence but still talking: its connection is being mended. */
  reconnecting?: boolean;
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
/** Everyone pings this often: the round trip, and a sign of life to the others. */
export const PING_MS = 5000;
/** Heard from this lately: connected, whatever presence says. */
export const LIVE_MS = 12_000;
/** In presence but not heard from for this long: its connection is gone, whatever presence says. */
export const GHOST_MS = 20_000;
/**
 * This many of my own pings in a row not back: the connection is dead without
 * saying so. Counted in pings, not time, so a device waking from sleep doesn't
 * take its own nap for a dead connection.
 */
export const ECHO_MISSES = 3;
/** While the room is known to exist (someone's in it), a join waits this long for the host's answer. */
const JOIN_GIVE_UP_MS = 30_000;
const DUTY_MS = 2000;
const JOIN_TIMEOUT_MS = 8000;
const NOTE_MS = 3500;
/** At most one answer to an out-of-date timeline this often. */
const ANSWER_MS = 1000;
/** The room's copy of my entry may lag this long before I send it again. */
export const HEAL_MS = 3000;
/**
 * Presence updates (joins included) sent at most this many per window: the
 * server's limit is 5 per 30 s per connection (#227), and the longer window
 * leaves room for delays on the way.
 */
export const PRESENCE_MAX = 5;
export const PRESENCE_WINDOW_MS = 32_000;
/** A change of status waits this long for more before it's sent: joining and opening the player is one update, not four. */
export const SETTLE_MS = 1000;
/** Missing from presence without a "bye": still shown this long, in case it's a blip. */
export const GONE_MS = 6000;
/** Further behind the room than this is worth showing ("4 s behind"). */
export const BEHIND_SHOWN = 2;
const UNREACHABLE = "Couldn't reach the watch party. Check your connection.";
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
  /** A relayed timeline that came before the first presence list (see `relayTakes`). */
  let earlyRelay: Record<string, unknown> | null = null;
  /** The members the server last listed, me as the server has me. */
  let listed: Member[] = [];
  /** Members missing from presence who didn't say bye, and since when. */
  const missing = new Map<string, { member: Member; since: number }>();
  /** Since when the server's copy of my entry has been out of date (or absent). */
  let staleSince: number | null = null;
  /** In presence but silent so long they're taken as gone (see GHOST_MS), until heard from again. */
  const ghosts = new Set<string>();
  /** Members who said bye: a presence list that still has them is out of date (ids aren't reused). */
  const left = new Set<string>();
  /** Someone else was seen in the room, so it exists (for what a failed join says). */
  let roomSeen = false;
  /** When each other member was last heard from (any message). */
  const heard = new Map<string, number>();
  /** The newest entry number each member's pings say it has. */
  const pinged = new Map<string, number>();
  /** When each member was last asked to send its presence entry again. */
  const asked = new Map<string, number>();
  /** When I last sent my entry again because someone asked (or the host still has me knocking). */
  let lastRenew = -Infinity;
  /** My pings sent since one last came back (or the connection opened). */
  let unanswered = 0;
  /** When I last asked the room for its timeline. */
  let lastHello = -Infinity;
  /** When the join started, for how long it may wait. */
  let joinStarted = 0;
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
  /** When my presence entry was sent (joins included), for the PRESENCE_MAX budget; kept across reconnects (it's per connection). */
  let entrySent: number[] = [];
  /** My entry, waiting for the end of SETTLE_MS or for the budget. */
  let cancelEntry: (() => void) | null = null;
  /** My entry sent this many times since the server's copy was last up to date. */
  let unconfirmed = 0;
  /** A reconnect waiting for the budget (a join sends my entry). */
  let cancelReopen: (() => void) | null = null;
  /** The newest of my timelines the host refused: my next change numbers past it, so a late refusal can't hit that one. */
  let refusedV = 0;
  /** Joiners the host was heard letting in: in, even while my copy of their entry still says knocking. */
  const admitted = new Set<string>();
  /** The last entry seen for each member, knockers included: shown while it talks but is missing from presence. */
  const known = new Map<string, Member>();

  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const log = createPartyLog();
  const say = (text: string) => log.add(clock.now(), text);

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

  /** Tell the room how I am now: every entry numbered, so the newest one wins. Shown here at once, sent once it settles. */
  function track(patch: Partial<Member>, wait = SETTLE_MS) {
    if (!self) return;
    self = { ...self, ...patch, seq: (self.seq ?? 0) + 1 };
    sendEntry(wait);
    refreshMembers();
  }

  /** When the budget next allows a presence update. */
  function entryFree() {
    const now = clock.now();
    entrySent = entrySent.filter((t) => now - t < PRESENCE_WINDOW_MS);
    return entrySent.length < PRESENCE_MAX ? now : entrySent[entrySent.length - PRESENCE_MAX] + PRESENCE_WINDOW_MS;
  }

  /** Send my entry after `wait` ms, or when the budget allows; one already on its way carries the newest anyway. */
  function sendEntry(wait: number) {
    if (cancelEntry || !link) return;
    const at = Math.max(clock.now() + wait, entryFree());
    cancelEntry = later(() => {
      cancelEntry = null;
      if (!self || !link || state?.status !== "live") return; // a join sends it
      entrySent.push(clock.now());
      unconfirmed++;
      if (staleSince != null) staleSince = clock.now();
      link.track(self);
    }, at - clock.now());
  }

  /** Drop the connection and open a new one, as soon as the budget allows the join's entry. */
  function reopen(why: string) {
    if (!link || cancelReopen) return;
    say(why);
    unanswered = 0;
    update({ status: "error" });
    cancelReopen = later(() => {
      cancelReopen = null;
      unanswered = 0;
      link?.reconnect();
    }, Math.max(0, entryFree() - clock.now()));
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
    log.reset(clock.wall(), clock.now());
    say(`started a party as ${tag(self.id)}; ${describeTimeline(state.playback!)}`);
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
    log.reset(clock.wall(), clock.now());
    say(`joining as ${tag(self.id)}`);
    const joined = new Promise<void>((resolve, reject) => (pendingJoin = { resolve, reject }));
    connect(code);
    placeInLine = true;
    joinStarted = clock.now();
    cancelJoinTimeout = later(joinTimedOut, JOIN_TIMEOUT_MS);
    emit();
    return joined;
  }

  /** Leave Party: gone for everyone at once, and the party UI goes away here. */
  function leaveParty() {
    if (self) say("left the party");
    if (self && link) link.send({ t: "bye", from: self.id });
    cancels.forEach((c) => c());
    cancels.clear();
    cancelJoinTimeout = null;
    cancelEntry = null;
    cancelReopen = null;
    unconfirmed = 0;
    refusedV = 0;
    known.clear();
    admitted.clear();
    placeInLine = false;
    link?.close();
    link = null;
    self = null;
    rtts = [];
    listed = [];
    earlyRelay = null;
    heard.clear();
    asked.clear();
    pinged.clear();
    left.clear();
    ghosts.clear();
    roomSeen = false;
    lastRenew = -Infinity;
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
    say(`out of the party: ${text}`);
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
      v: Math.max(cur.v, refusedV) + 1,
      by: self.id,
      media: patch.media ?? cur.media,
      paused: patch.paused ?? cur.paused,
      held: patch.held ?? cur.held,
      position: patch.position ?? expectedPosition(cur),
      lag: myLag(),
    };
    update({ playback: { ...next, at: clock.now() } });
    say(`sent ${describeTimeline(next)}`);
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
    sayRules(rules, self.id);
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
    admitted.add(id);
    say(`let ${tag(id)} in`);
    link?.send({ t: "admit", from: self.id, to: id });
  }

  /** Host: turn a waiting joiner away. */
  function deny(id: string) {
    if (!self || !isHost()) return;
    answered.set(id, { at: clock.now(), refuse: "denied" });
    say(`turned ${tag(id)} away`);
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
        if (s === "closed") return reopen(`connection: closed by the server${detail?.message ? ` (${detail.message})` : ""}: reconnecting`);
        say(`connection: ${s}${detail?.setup ? " (the server refuses watch parties)" : ""}`);
        if (s === "error") {
          // Refused outright: no use waiting. A dropped connection comes back by itself (the library
          // rejoins), so a join waits for it, until JOIN_TIMEOUT_MS says it couldn't get there.
          if (pendingJoin && detail?.setup) return failJoin(NOT_SET_UP);
          // Refused outright: retrying can't help, so stop and say why.
          if (detail?.setup) {
            link?.close();
            link = null;
          }
          update({ status: "error", error: detail?.setup ? NOT_SET_UP : undefined });
          return;
        }
        unanswered = 0;
        // The join sent my entry (as the link had it last): it counts against the budget.
        entrySent.push(clock.now());
        unconfirmed = 1;
        // Nobody could be heard while I was cut off: their silence counts from now.
        for (const m of listed) heard.set(m.id, Math.max(heard.get(m.id) ?? 0, clock.now()));
        if (ghosts.size) {
          ghosts.clear();
          refreshMembers();
        }
        update({ status: "live", error: undefined });
        ping();
        // Ask for the timeline (again, after a reconnect: messages may have been missed).
        hello();
      },
    });
    unanswered = 0;
    cancels.add(clock.every(ping, PING_MS));
    cancels.add(clock.every(heartbeat, HEARTBEAT_MS));
    cancels.add(clock.every(duty, DUTY_MS));
  }

  /**
   * No answer yet. With nobody in the room, there's no such party; with
   * someone there, the host's answer or my connection is slow: wait longer.
   */
  function joinTimedOut() {
    cancelJoinTimeout = null;
    if (!state?.knocking && state?.playback) return;
    const someone = roomSeen;
    if (someone && clock.now() - joinStarted < JOIN_GIVE_UP_MS) {
      say("no answer from the host yet: still waiting");
      cancelJoinTimeout = later(joinTimedOut, JOIN_TIMEOUT_MS);
      return;
    }
    failJoin(someone || state?.status !== "live" ? UNREACHABLE : "There's no watch party with that code.");
  }

  function failJoin(message: string) {
    const p = pendingJoin;
    if (!p) return;
    say(`join failed: ${message}`);
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
    say("let in");
    update({ knocking: false });
    track({ knock: false });
    joined();
  }

  function hello() {
    if (!self || !link) return;
    lastHello = clock.now();
    link.send({ t: "hello", from: self.id });
  }

  function ping() {
    if (!self || !link || !state) return;
    // My pings stopped coming back: the connection died without a word. Open a new one.
    if (state.status === "live" && unanswered >= ECHO_MISSES) return reopen(`my last ${unanswered} pings haven't come back: reconnecting`);
    link.send({ t: "ping", from: self.id, sent: clock.now(), seq: self.seq ?? 0 });
    unanswered++;
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
  /** Who's let in, given up on, removed: said in the log each time it changes, not on each heartbeat. */
  function sayRules(rules: RoomRules, by: string) {
    const flags = [rules.locked && "locked", rules.approve && "approve", rules.control === "host" && "host-only", !rules.wait && "no-wait"].filter(Boolean);
    say(`rules v${rules.v} from ${tag(by)}: host ${rules.host ? tag(rules.host) : "first in line"}${flags.length ? `, ${flags.join(", ")}` : ""}${rules.out.length ? `, removed ${rules.out.map(tag).join(" ")}` : ""}`);
  }

  /** The room's timeline as I have it; `no`: the one I'm refusing with it (host only). */
  function sendTimeline(no?: Pick<Timeline, "v" | "by">) {
    const p = state?.playback;
    if (!p || !self) return;
    const { at: _at, ...tl } = p;
    link?.send({ t: "state", from: self.id, tl: { ...tl, position: expectedPosition(p), lag: myLag() }, ...(no && { no }) });
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
    if (from !== self.id) {
      if (left.has(from)) return;
      roomSeen = true;
      sayHeard(msg);
      // A sign of life: someone missing from presence but still talking is shown as connected.
      const wasGhost = ghosts.delete(from);
      if (wasGhost) say(`${tag(from)} heard from again`);
      const wasLost = isLost(from) || wasGhost;
      heard.set(from, clock.now());
      if (wasLost) refreshMembers();
    } else unanswered = 0;
    switch (msg.t) {
      case "ping": {
        const rtt = from === self.id ? roundTrip(msg.sent, clock.now()) : undefined;
        if (rtt !== undefined) rtts = [...rtts.slice(-4), rtt];
        // Its entry here is older than the one it has: the update never reached me. Ask for it again.
        if (from !== self.id && msg.seq) {
          pinged.set(from, msg.seq);
          askIfStale(from);
        }
        return;
      }
      case "presence":
        if (msg.to === self.id && from !== self.id) renew(`${tag(from)} asked`);
        return;
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
        left.add(from);
        known.delete(from);
        heard.delete(from);
        pinged.delete(from);
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
        // From the host, or from whoever the rules name as host; a joiner with none yet takes the first.
        const fromHost = from === state.hostId || from === rules.host || cur.v === 0;
        // Newer, or from a host other than whoever set ours: the role changed hands, and its rules are the room's
        // even if it never got the last ones (versions only order one host's changes).
        const handedOver = from === state.hostId && from !== rulesBy && presenceSeen;
        if (!handedOver && (rules.v < cur.v || (rules.v === cur.v && from <= rulesBy))) return;
        if (!fromHost || (presenceSeen && !inRoom(from) && from !== self.id)) return;
        if (rules.out.includes(self.id)) return exitWith(KICKED);
        const removed = state.members.filter((m) => rules.out.includes(m.id) && !cur.out.includes(m.id));
        if (rules.v !== cur.v || from !== rulesBy) sayRules(rules, from);
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
        if (from !== self.id && from === state.hostId && msg.to !== self.id && !admitted.has(msg.to)) {
          admitted.add(msg.to);
          refreshMembers();
        }
        if (msg.to !== self.id || !inRoom(from) || from === self.id) return;
        // Let in again: the host's copy of my entry still has me knocking.
        if (!state.knocking) renew("the host still has me knocking");
        letIn();
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
        const relay = tl.by !== from;
        // Whose relay counts depends on who's here: kept until the first presence list says.
        if (relay && !presenceSeen) return void (earlyRelay = raw);
        // The host refuses the timeline I hold (mine, or one I took from its author): the host's word goes.
        const refused = !!msg.no && !!cur && from === state.hostId && msg.no.v === cur.v && msg.no.by === cur.by;
        if (refused) {
          say(`the host refused v${cur.v} by ${tag(cur.by)}: taking its timeline`);
          if (cur.by === self.id) refusedV = Math.max(refusedV, cur.v);
        }
        const takes = refused || (relay ? relayTakes(from, cur, tl) : takesOver(cur, tl, presenceSeen ? state.members : null, state.hostId, state.rules.control === "host"));
        if (!takes) {
          // The sender missed our newer action (a dropped message): send ours, or each
          // side would follow its own timeline from here on, the host's heartbeat included.
          const ahead = cur && (cur.v > tl.v || (cur.v === tl.v && cur.by > tl.by));
          if (cur && (tl.v !== cur.v || tl.by !== cur.by)) say(`not taken: ${describeTimeline(tl)} (ours v${cur.v} by ${tag(cur.by)})`);
          if (ahead && !state.knocking && clock.now() - lastAnswer >= ANSWER_MS) {
            lastAnswer = clock.now();
            say(`answered with ours, v${cur.v}`);
            sendTimeline();
          } else if (!ahead && cur && isHost() && !relay && clock.now() - lastAnswer >= ANSWER_MS) {
            // Newer than ours, and not taken (its author isn't in the room as I see it): say so, or the
            // member would keep it, and so would anyone who took it (#227).
            lastAnswer = clock.now();
            say(`refused v${tl.v} by ${tag(tl.by)}: answered with ours, v${cur.v}`);
            sendTimeline({ v: tl.v, by: tl.by });
          }
          return;
        }
        const next: Playback = { ...tl, at: clock.now() - (tl.lag + myLag()) * 1000 };
        if (!cur || tl.v !== cur.v || tl.by !== cur.by)
          say(`took ${describeTimeline(tl)}${relay ? `, passed on by ${tag(from)}` : ""}${cur && cur.media.videoId !== tl.media.videoId ? ", another video" : ""}`);
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

  /** Send my entry again (someone's copy of it is missing or stale), at most once per HEAL_MS. */
  function renew(why: string) {
    if (!self || clock.now() - lastRenew < HEAL_MS) return;
    lastRenew = clock.now();
    say(`sending my entry again: ${why}`);
    track({}, 0);
  }

  /** Ask a member to send its presence entry again, at most once per HEAL_MS each. */
  function askForEntry(id: string, why: string) {
    if (!self || clock.now() - (asked.get(id) ?? -Infinity) < HEAL_MS) return;
    asked.set(id, clock.now());
    say(`asked ${tag(id)} for its entry: ${why}`);
    link?.send({ t: "presence", from: self.id, to: id });
  }

  /** My copy of its entry is older than the one its pings say it has: the update never reached me. */
  function askIfStale(id: string) {
    const entry = listed.find((m) => m.id === id);
    const theirs = pinged.get(id) ?? 0;
    if (entry && (entry.seq ?? 0) < theirs) askForEntry(id, `my copy of ${tag(id)}'s entry is #${entry.seq ?? 0}, it's on #${theirs}`);
  }

  /** Shown as Disconnected: missing from presence and not heard from lately, or in it but silent for long. */
  function isLost(id: string) {
    const quiet = clock.now() - (heard.get(id) ?? -Infinity);
    return missing.has(id) ? quiet >= LIVE_MS : quiet >= GHOST_MS;
  }

  /**
   * A timeline passed on by someone other than its author: taken from the host
   * (who vouches for the room's timeline anyway), or, when everyone controls
   * playback, from anyone in the room about an author who's no longer here to
   * send it. Nobody else can put words in another member's mouth.
   */
  function relayTakes(from: string, cur: Playback | null, tl: Timeline) {
    if (!state || !inRoom(from)) return false;
    const host = from === state.hostId;
    if (!host && (state.rules.control !== "everyone" || inRoom(tl.by))) return false;
    if (!cur) return true;
    if (tl.v < cur.v || (tl.v === cur.v && tl.by < cur.by)) return false;
    return host || tl.v - cur.v <= V_JUMP_MAX;
  }

  function presence(list: Member[]) {
    if (!state || !self) return;
    list = list.filter((m) => !left.has(m.id));
    if (list.some((m) => m.id !== self!.id)) roomSeen = true;
    // Who hosts next goes by `joinedAt`. Each member's clock sets its own, and clocks
    // differ, so on joining take the place after everyone already there instead.
    if (placeInLine) {
      placeInLine = false;
      const last = Math.max(0, ...list.filter((m) => m.id !== self!.id).map((m) => m.joinedAt));
      if (self.joinedAt <= last) track({ joinedAt: last + 1 });
    }
    say(`presence: ${list.map(describeEntry).join(", ") || "empty"}`);
    for (const m of list) known.set(m.id, m);
    const now = clock.now();
    // Silence is counted from when a member first shows up, until it's heard from.
    for (const m of list) if (m.id !== self.id && !heard.has(m.id)) heard.set(m.id, now);
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
      for (const m of listed)
        if (!after.has(m.id) && !m.knock && m.id !== self.id && !missing.has(m.id)) {
          say(`${tag(m.id)} missing from presence without a bye`);
          missing.set(m.id, { member: m, since: now });
        }
    }
    for (const id of after) if (missing.delete(id)) say(`${tag(id)} back in presence`);
    presenceSeen = true;
    listed = list;
    refreshMembers();
    if (earlyRelay) {
      const raw = earlyRelay;
      earlyRelay = null;
      receive(raw);
    }
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
    if (presenceSeen && upToDate) unconfirmed = 0;
    const out = state.rules.out;
    const others = listed
      .filter((m) => m.id !== me.id && !missing.has(m.id) && !ghosts.has(m.id) && !out.includes(m.id))
      .map((m) => (m.knock && admitted.has(m.id) ? { ...m, knock: undefined } : m))
      .map((m) => (isLost(m.id) ? { ...m, lost: true } : m));
    const lost = [...missing.values()]
      .filter((x) => !out.includes(x.member.id))
      .map((x) => (isLost(x.member.id) ? { ...x.member, lost: true } : { ...x.member, reconnecting: true }));
    // Talking, let in, but gone from presence before I saw it in (a rejoin under a new id whose entry the server dropped).
    const unlisted = talkingUnlisted().map((id) => ({ ...known.get(id)!, knock: undefined, reconnecting: true }));
    const members = [...others.filter((m) => !m.knock), ...lost, ...unlisted, me].sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
    const knockers = others.filter((m) => m.knock && answered.get(m.id)?.refuse === undefined);
    // The host is whoever it handed the role to, while really there; else the first who is.
    const present = members.filter((m) => !m.lost && !m.knock);
    const named = state.rules.host ? present.find((m) => m.id === state!.rules.host) : undefined;
    const hostId = (named ?? present[0])?.id ?? null;
    const before = state.hostId;
    update({ members, knockers, hostId });
    if (before !== hostId) say(`host is now ${hostId === me.id ? "me" : tag(hostId)}`);
    if (presenceSeen && before && hostId && before !== hostId) {
      const who = members.find((m) => m.id === hostId) ?? null;
      note(who, "is now the host");
    }
  }

  /** Members heard from lately that presence doesn't list, whose entry I've seen and who've been let in. */
  function talkingUnlisted() {
    if (!state || !self) return [];
    const now = clock.now();
    return [...heard]
      .filter(([id, at]) => now - at < LIVE_MS && id !== self!.id && known.has(id) && !missing.has(id) && !listed.some((m) => m.id === id))
      .filter(([id]) => !state!.rules.out.includes(id) && (!known.get(id)!.knock || admitted.has(id)))
      .map(([id]) => id);
  }

  /** Every couple of seconds: mend my entry, give up on the missing, hold or release the room. */
  function duty() {
    if (!state || !self) return;
    const now = clock.now();
    // Still without the room's timeline (the answers were lost): ask again.
    if (!state.playback && state.status === "live" && now - lastHello >= HEAL_MS) {
      say("no timeline yet: asked again");
      hello();
    }
    // (Not while an entry waits to go: that one is the newest.)
    if (staleSince != null && now - staleSince >= HEAL_MS && link && !cancelEntry && state.status === "live") {
      staleSince = now;
      // Sent twice and still not there: the connection carries nothing in, or nothing of mine (#227).
      if (unconfirmed >= 2) reopen(`the server's copy of my entry is still out of date after sending it again (#${self.seq ?? 0}): reconnecting`);
      else {
        say(`the server's copy of my entry is out of date: sending it again (#${self.seq ?? 0})`);
        sendEntry(0);
      }
    }
    let gone = false;
    for (const [id, { member, since }] of missing) {
      // Shown as Disconnected for GONE_MS first: from leaving presence, or from last being heard.
      if (!isLost(id) || now - Math.max(since, (heard.get(id) ?? -Infinity) + LIVE_MS) < GONE_MS) continue;
      say(`${tag(id)} gone: missing from presence, not heard from for ${Math.round((now - (heard.get(id) ?? since)) / 1000)} s`);
      missing.delete(id);
      heard.delete(id);
      known.delete(id);
      if (!state.quiet && !state.rules.out.includes(id)) note(member, "left");
      gone = true;
    }
    // In presence, but silent for so long that its entry is a leftover (its leave never reached me).
    for (const m of state.status === "live" ? listed : []) {
      if (m.id === self.id || missing.has(m.id) || ghosts.has(m.id) || now - (heard.get(m.id) ?? now) < GHOST_MS + GONE_MS) continue;
      say(`${tag(m.id)} gone: in presence, but not heard from for ${Math.round((now - heard.get(m.id)!) / 1000)} s`);
      ghosts.add(m.id);
      if (!state.quiet && !m.knock && !state.rules.out.includes(m.id)) note(m, "left");
      gone = true;
    }
    if (gone && !state.quiet) deps.chime("leave");
    // Someone talking that my presence list lacks (or has only as it was): ask for its entry again.
    for (const id of pinged.keys()) askIfStale(id);
    for (const [id, at] of heard) {
      if (now - at >= LIVE_MS || state.rules.out.includes(id) || id === self.id) continue;
      if (listed.some((m) => m.id === id) && !missing.has(id)) continue;
      askForEntry(id, "talking, but missing from my presence list");
    }
    const shownLost = state.members.filter((m) => m.lost).map((m) => m.id);
    const nowLost = state.members.filter((m) => m.id !== self!.id && isLost(m.id)).map((m) => m.id);
    const shownUnlisted = state.members.filter((m) => m.reconnecting && !missing.has(m.id)).map((m) => m.id);
    const changed = shownLost.sort().join() !== nowLost.sort().join() || shownUnlisted.sort().join() !== talkingUnlisted().sort().join();
    if (gone || changed) refreshMembers();
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
    // Hosting without ever having had the rules (the message was lost): make some, or there are none to pass on.
    if (state.rules.v === 0) return setRules({});
    const clockNow = clock.now();
    // Joiners still knocking, those turned away for a lock included: a lost answer is sent again.
    const knocking = listed.filter((m) => m.knock && !state!.rules.out.includes(m.id) && answered.get(m.id)?.refuse !== "denied");
    for (const k of knocking) {
      const a = answered.get(k.id);
      if (a && clockNow - a.at < DUTY_MS) continue; // answered; again if it's still knocking
      if (state.rules.locked) {
        answered.set(k.id, { at: clockNow, refuse: "locked" });
        say(`turned ${tag(k.id)} away: locked`);
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

  /** A timeline as the log says it: version, author, play state, position; never what's on. */
  function describeTimeline(tl: Timeline) {
    return `v${tl.v} by ${tag(tl.by)}: ${tl.paused ? "paused" : "playing"}${tl.held ? ", held" : ""} at ${tl.position.toFixed(1)} s`;
  }

  function describeEntry(m: Member) {
    const flags = [m.knock && "knocking", m.waiting && "loading", m.away && "away", m.buffering && "buffering"].filter(Boolean);
    return `${tag(m.id)}${m.id === self?.id ? " (me)" : ""} #${m.seq ?? 0}${flags.length ? ` ${flags.join(" ")}` : ""}`;
  }

  /** Messages from others, as the log has them (timelines and rules are said where they're taken). */
  function sayHeard(msg: PartyMessage) {
    const from = tag(msg.from);
    switch (msg.t) {
      case "hello":
      case "bye":
      case "end":
        return say(`${msg.t} from ${from}`);
      case "admit":
      case "kick":
        return say(`${msg.t} ${tag(msg.to)} from ${from}`);
      case "refuse":
        return say(`refuse ${tag(msg.to)} (${msg.why}) from ${from}`);
    }
  }

  /** The log to copy, with who's in as this device sees it now; `about`: lines first (app version, platform). */
  function partyLog(about: string[] = []) {
    const summary = state
      ? [
          `Now: me ${tag(state.me)}, host ${tag(state.hostId)}, ${state.status}${state.knocking ? ", knocking" : ""}; round trip ${rtts.length ? `${Math.round(Math.min(...rtts))} ms` : "not measured"}`,
          `Members: ${state.members.map((m) => `${tag(m.id)} ${memberStatus(m, state!.playback)}`).join(", ")}`,
          ...(state.playback ? [`Timeline: ${describeTimeline(state.playback)}`] : []),
        ]
      : ["Now: not in a party"];
    return log.text([...about, ...summary]);
  }

  function note(who: Member | null, text: string, system = false) {
    if (!state) return;
    const n: PartyNote = system ? { id: ++noteId, who, text, system } : { id: ++noteId, who, text };
    update({ notes: [...state.notes.slice(-2), n] });
    later(() => state && update({ notes: state.notes.filter((x) => x.id !== n.id) }), NOTE_MS);
  }

  return {
    getParty: () => state,
    partyLog,
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

export type MemberStatus = "Disconnected" | "Reconnecting" | "Away" | "Loading" | "Buffering" | "Paused" | "Watching";

/** What a member is doing, worded the same on every screen. */
export function memberStatus(m: Member, playback: Playback | null): MemberStatus {
  if (m.lost) return "Disconnected";
  if (m.reconnecting) return "Reconnecting";
  if (m.away) return "Away";
  if (m.waiting) return "Loading";
  if (m.buffering) return "Buffering";
  return playback?.paused ? "Paused" : "Watching";
}
