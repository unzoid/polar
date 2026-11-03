/**
 * Watch parties: everyone plays their own copy of the same video, and the
 * room only agrees on a timeline — what's on, where, paused or not.
 *
 * - The timeline is last-action-wins, ordered by (version, author), so two
 *   people pressing pause at once still end on the same state everywhere.
 * - No shared clock: each message carries its sender's one-way latency
 *   (half the round trip of its own echo) and the receiver adds its own, so
 *   positions are extrapolated to "now" without trusting anyone's system time.
 * - The host (first to have joined) holds the room while anyone is loading or
 *   buffering, and answers newcomers. Leaving hands the role to the next.
 * - Stream URLs never leave the device (service links carry API keys): only a
 *   hint — the p2p hash and release name — so others pick the same file
 *   from their own add-ons.
 */
import { useSyncExternalStore } from "react";
import { backend, type PartyLink, type PartyPresence } from "../account";
import { formatTime } from "../format";
import type { ContentType, Stream } from "../types";

export interface StreamHint {
  hash?: string;
  release?: string;
}

export interface PartyMedia {
  type: ContentType;
  metaId: string;
  videoId: string;
  /** "S1:E5 · Title", for "Sam put on …". */
  label?: string;
  hint?: StreamHint;
}

interface Timeline {
  v: number;
  by: string;
  media: PartyMedia;
  /** Someone pressed pause. */
  paused: boolean;
  /** The host is holding for someone loading or buffering. */
  held: boolean;
  position: number;
  /** The sender's one-way latency estimate, seconds. */
  lag: number;
}

export interface Playback extends Timeline {
  /** performance.now() at which `position` was current here. */
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

/** A waiter the room gives up holding for, so one bad connection can't stall everyone. */
const HOLD_MAX_MS = 30_000;
const HEARTBEAT_MS = 10_000;
const JOIN_TIMEOUT_MS = 8000;
const NOTE_MS = 3500;
const NOT_SET_UP = "Watch parties aren't set up on this server yet. Apply the watch_parties migration in Supabase.";
/** No ambiguous characters (0/O, 1/I/L). */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

let state: PartyState | null = null;
let link: PartyLink | null = null;
let self: Member | null = null;
let rtts: number[] = [];
let timers: number[] = [];
const waitingSince = new Map<string, number>();
let pendingJoin: { resolve: () => void; reject: (e: Error) => void } | null = null;
let noteId = 0;
let presenceSeen = false;

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function update(patch: Partial<PartyState>) {
  if (!state) return;
  state = { ...state, ...patch };
  emit();
}

// --- Public ------------------------------------------------------------------

export const partyAvailable = () => !!backend;
export const getParty = () => state;

export function useParty() {
  return useSyncExternalStore(subscribe, getParty);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Where the room is right now, extrapolated from the last action. */
export function expectedPosition(p: Playback) {
  return p.paused || p.held ? p.position : p.position + (performance.now() - p.at) / 1000;
}

/** The room's position for this video, if the room is on it. */
export function partyPosition(videoId: string) {
  const p = state?.playback;
  return p && p.media.videoId === videoId ? expectedPosition(p) : undefined;
}

/** What others need to find the same file, without the URL itself. */
export function streamHint(s?: Stream): StreamHint | undefined {
  if (!s) return undefined;
  const hash = (s.content_id ?? s.url?.match(/\b[a-f0-9]{40}\b/i)?.[0])?.toLowerCase();
  const release = (s.title ?? s.description ?? "").split("\n")[0].trim() || undefined;
  return hash || release ? { hash, release } : undefined;
}

export function sameFile(s: Stream, hint: StreamHint) {
  const h = streamHint(s);
  if (!h) return false;
  if (hint.hash && h.hash) return hint.hash === h.hash;
  return !!hint.release && hint.release.toLowerCase() === h.release?.toLowerCase();
}

export function normalizeCode(input: string) {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH);
}

/** Open a room on what's playing now. */
export function startParty(media: PartyMedia, position: number, paused: boolean, me: Pick<Member, "name" | "avatar">) {
  leaveParty();
  const code = newCode();
  // The opener is always first in line to host, whatever the clocks say.
  self = { id: crypto.randomUUID(), name: me.name, avatar: me.avatar, joinedAt: 0, waiting: false };
  state = {
    code,
    status: "connecting",
    me: self.id,
    hostId: self.id,
    members: [self],
    playback: { v: 1, by: self.id, media, paused, held: false, position, lag: 0, at: performance.now() },
    notes: [],
  };
  connect(code);
  emit();
  return code;
}

/** Join by code. Resolves once the room's timeline has arrived. */
export function joinParty(input: string, me: Pick<Member, "name" | "avatar">) {
  const code = normalizeCode(input);
  if (code.length !== CODE_LENGTH) return Promise.reject(new Error("Party codes are 6 letters and numbers."));
  if (state?.code === code) return Promise.resolve();
  leaveParty();
  // Waiting from the start: the room holds until this player is up.
  self = { id: crypto.randomUUID(), name: me.name, avatar: me.avatar, joinedAt: Date.now(), waiting: true };
  state = { code, status: "connecting", me: self.id, hostId: null, members: [self], playback: null, notes: [] };
  const joined = new Promise<void>((resolve, reject) => (pendingJoin = { resolve, reject }));
  connect(code);
  timers.push(window.setTimeout(() => failJoin("There's no watch party with that code."), JOIN_TIMEOUT_MS));
  emit();
  return joined;
}

export function leaveParty() {
  timers.forEach((t) => window.clearTimeout(t));
  timers = [];
  link?.close();
  link = null;
  self = null;
  rtts = [];
  waitingSince.clear();
  pendingJoin?.reject(new Error("Left the party."));
  pendingJoin = null;
  if (state) {
    state = null;
    emit();
  }
}

/** A change made here: becomes the room's newest timeline. */
export function partyAct(patch: Partial<Pick<Timeline, "media" | "paused" | "held" | "position">>) {
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
  update({ playback: { ...next, at: performance.now() } });
  link?.send({ t: "state", from: self.id, tl: next });
  hostDuty();
}

/** Loading or buffering: the host holds the room until this clears. */
export function setPartyWaiting(waiting: boolean) {
  if (!self || self.waiting === waiting) return;
  self = { ...self, waiting };
  link?.track(self);
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

// --- Internals ---------------------------------------------------------------

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

function myLag() {
  return rtts.length ? Math.min(...rtts) / 2000 : 0.08;
}

function connect(code: string) {
  if (!backend || !self) return;
  presenceSeen = false;
  link = backend.party.connect(code, self, {
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
  timers.push(window.setInterval(ping, HEARTBEAT_MS));
  timers.push(window.setInterval(heartbeat, HEARTBEAT_MS));
  timers.push(window.setInterval(hostDuty, 2000));
}

function failJoin(message: string) {
  const p = pendingJoin;
  if (!p) return;
  pendingJoin = null;
  leaveParty();
  p.reject(new Error(message));
}

function ping() {
  if (self) link?.send({ t: "ping", from: self.id, sent: performance.now() });
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

function receive(msg: Record<string, unknown>) {
  if (!state || !self) return;
  const from = msg.from as string;
  switch (msg.t) {
    case "ping":
      if (from === self.id) rtts = [...rtts.slice(-4), performance.now() - (msg.sent as number)];
      return;
    case "hello":
      // Whoever has the timeline answers; ties resolve themselves (same version).
      if (from !== self.id) sendTimeline();
      return;
    case "state": {
      if (from === self.id) return; // applied when it was made
      const tl = msg.tl as Timeline;
      const cur = state.playback;
      if (cur && (tl.v < cur.v || (tl.v === cur.v && tl.by < cur.by))) return;
      const next: Playback = { ...tl, at: performance.now() - (tl.lag + myLag()) * 1000 };
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
  const members = [...list].sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
  const before = new Set(state.members.map((m) => m.id));
  const after = new Set(members.map((m) => m.id));
  // The first list is who was already there: not news.
  if (presenceSeen) {
    members.filter((m) => !before.has(m.id) && m.id !== self!.id).forEach((m) => note(m, "joined"));
    state.members.filter((m) => !after.has(m.id) && m.id !== self!.id).forEach((m) => note(m, "left"));
  }
  presenceSeen = true;
  update({ members, hostId: members[0]?.id ?? null });
  hostDuty();
}

/** Host: hold the room while anyone (not given up on) is loading or buffering. */
function hostDuty() {
  const p = state?.playback;
  if (!state || !self || !p || state.hostId !== self.id) return;
  const now = Date.now();
  for (const m of state.members) {
    if (m.waiting) waitingSince.set(m.id, waitingSince.get(m.id) ?? now);
    else waitingSince.delete(m.id);
  }
  for (const id of waitingSince.keys()) if (!state.members.some((m) => m.id === id)) waitingSince.delete(id);
  const hold = state.members.some((m) => m.waiting && now - waitingSince.get(m.id)! < HOLD_MAX_MS);
  if (hold !== p.held) partyAct({ held: hold });
}

/** "Sam paused", "Sam jumped to 12:30" — for actions by others. */
function describe(prev: Playback, next: Playback) {
  if (next.held !== prev.held) return; // the host holding, not anyone's action
  const who = state?.members.find((m) => m.id === next.by) ?? null;
  if (prev.media.videoId !== next.media.videoId) return note(who, next.media.label ? `put on ${next.media.label}` : "changed what's playing");
  if (JSON.stringify(prev.media) !== JSON.stringify(next.media)) return; // filled in the label or stream hint
  if (prev.paused !== next.paused) return note(who, next.paused ? "paused" : "resumed");
  if (Math.abs(next.position - expectedPosition(prev)) > 3) note(who, `jumped to ${formatTime(next.position)}`);
}

function note(who: Member | null, text: string) {
  if (!state) return;
  const n = { id: ++noteId, who, text };
  update({ notes: [...state.notes.slice(-2), n] });
  timers.push(
    window.setTimeout(() => state && update({ notes: state.notes.filter((x) => x.id !== n.id) }), NOTE_MS),
  );
}
