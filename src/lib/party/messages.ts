/**
 * What arrives from a watch-party room, checked before use (critique M11).
 *
 * Anyone with a free account and the code can join a room and send anything,
 * so every message and presence entry is parsed here: wrong shapes are dropped,
 * text is cut to size, numbers are kept in range. Pure, so it's tested without
 * a room (tests/partyMessages.test.ts).
 *
 * What this can't stop: the room has no server of its own, so ids are only
 * what members say they are. A member can still claim another's id or an early
 * `joinedAt` (and so the host role); what they can no longer do is win every
 * tie for good, freeze the room, or send text and numbers the UI can't take.
 */
import { normalizeAvatar } from "../account/avatars";
import type { PartyPresence } from "../account/backend";
import type { ContentType } from "../types";
import { checkLink, isLinkId, linkId } from "./links";
import { isFileId } from "../localFiles/ids";

export interface StreamHint {
  release?: string;
}

export interface PartyMedia {
  type: ContentType;
  metaId: string;
  videoId: string;
  /** "S1:E5 · Title", for "Sam put on …". */
  label?: string;
  hint?: StreamHint;
  /** A pasted link (#136): each member's player opens it itself. Its ids are `linkId(url)`. */
  url?: string;
}

export interface Timeline {
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

/**
 * How the room runs, set by its host (#156). Versioned like the timeline:
 * the highest `v` from whoever hosts wins.
 */
export interface RoomRules {
  v: number;
  /** Who the host handed the role to; null: the first in line hosts. */
  host: string | null;
  /** No new joins: the code stops working until unlocked. */
  locked: boolean;
  /** Who may play, pause, seek and change episodes. */
  control: "everyone" | "host";
  /** Hold playback while someone is loading the video. */
  wait: boolean;
  /** New joiners wait for the host's OK. */
  approve: boolean;
  /** Removed by the host: not shown, not listened to. */
  out: string[];
}

export const DEFAULT_RULES: RoomRules = { v: 0, host: null, locked: false, control: "everyone", wait: true, approve: false, out: [] };

/** Why a joiner was turned away. */
export type Refusal = "locked" | "denied";

export type PartyMessage =
  /** `seq`: the sender's newest presence entry, so a stale copy of it shows (#203). */
  | { t: "ping"; from: string; sent: number; seq?: number }
  | { t: "hello"; from: string }
  | { t: "bye"; from: string }
  /** `no`: the host refuses that timeline (a member's change it didn't take, #227); whoever holds it takes this one instead. */
  | { t: "state"; from: string; tl: Timeline; no?: Pick<Timeline, "v" | "by"> }
  | { t: "rules"; from: string; rules: RoomRules }
  /** Host: let this joiner in. */
  | { t: "admit"; from: string; to: string }
  /** Host: turn this joiner away. */
  | { t: "refuse"; from: string; to: string; why: Refusal }
  /** Host: remove this member. */
  | { t: "kick"; from: string; to: string }
  /** Host: the party is over for everyone. */
  | { t: "end"; from: string }
  /** "Your presence entry is missing or out of date here: send it again" (#203). */
  | { t: "presence"; from: string; to: string }
  /** Where this member's player is, for "3 s behind". */
  | { t: "at"; from: string; videoId: string; position: number; paused: boolean; lag: number };

const ID_MAX = 64;
/** More removals than any real party makes; the oldest drop off. */
export const OUT_MAX = 50;
const NAME_MAX = 40;
const MEDIA_ID_MAX = 200;
const LABEL_MAX = 120;
const RELEASE_MAX = 300;
/** Longer than any video; positions past it are someone's mistake or mischief. */
const POSITION_MAX = 7 * 24 * 3600;
/** One-way latency above this isn't a connection anyone could watch together on. */
export const LAG_MAX = 5;
/**
 * How far ahead of ours a member's version may be. Each action adds one, so a
 * real member is never far ahead; the host may be (we missed messages while
 * offline) and its timeline is always taken.
 */
export const V_JUMP_MAX = 50;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** A string of at most `max` characters with no control characters, or undefined. */
function text(x: unknown, max: number): string | undefined {
  if (typeof x !== "string") return undefined;
  const s = x.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return s ? s.slice(0, max) : undefined;
}

/** A member id: short, and only the characters UUIDs are made of. */
function id(x: unknown): string | undefined {
  return typeof x === "string" && x.length > 0 && x.length <= ID_MAX && /^[\w-]+$/.test(x) ? x : undefined;
}

/** A title or video id (`tt…`, `kitsu:N:E`, whatever an addon uses): short, no spaces or control characters. */
function mediaId(x: unknown): string | undefined {
  return typeof x === "string" && x.length > 0 && x.length <= MEDIA_ID_MAX && /^[^\s\u0000-\u001f\u007f]+$/.test(x) ? x : undefined;
}

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function parseMedia(x: unknown): PartyMedia | undefined {
  if (!isRecord(x) || (x.type !== "movie" && x.type !== "series")) return undefined;
  const metaId = mediaId(x.metaId);
  const videoId = mediaId(x.videoId);
  if (!metaId || !videoId) return undefined;
  // A file on someone's device (#204): nobody else can open it.
  if (isFileId(metaId) || isFileId(videoId)) return undefined;
  const media: PartyMedia = { type: x.type, metaId, videoId };
  if (x.url !== undefined) {
    // A link must be one the app would share itself, and its ids must be its own: no other title's ids on it.
    const link = typeof x.url === "string" ? checkLink(x.url) : undefined;
    if (!link?.ok || link.url !== x.url || videoId !== linkId(link.url) || metaId !== videoId) return undefined;
    media.url = link.url;
  } else if (isLinkId(metaId) || isLinkId(videoId)) return undefined;
  const label = text(x.label, LABEL_MAX);
  if (label) media.label = label;
  const release = isRecord(x.hint) ? text(x.hint.release, RELEASE_MAX) : undefined;
  if (release) media.hint = { release };
  return media;
}

export function parseTimeline(x: unknown): Timeline | undefined {
  if (!isRecord(x)) return undefined;
  const by = id(x.by);
  const media = parseMedia(x.media);
  // A safe integer: past 2^53, v + 1 === v and whoever sent it could never be overtaken.
  if (!by || !media || !Number.isSafeInteger(x.v) || (x.v as number) < 1) return undefined;
  if (typeof x.paused !== "boolean" || typeof x.held !== "boolean" || !finite(x.position)) return undefined;
  return {
    v: x.v as number,
    by,
    media,
    paused: x.paused,
    held: x.held,
    position: clamp(x.position, 0, POSITION_MAX),
    lag: finite(x.lag) ? clamp(x.lag, 0, LAG_MAX) : 0,
  };
}

export function parseRules(x: unknown): RoomRules | undefined {
  if (!isRecord(x) || !Number.isSafeInteger(x.v) || (x.v as number) < 1) return undefined;
  if (typeof x.locked !== "boolean" || typeof x.wait !== "boolean" || typeof x.approve !== "boolean") return undefined;
  if (x.control !== "everyone" && x.control !== "host") return undefined;
  const host = x.host === null ? null : id(x.host);
  if (host === undefined || !Array.isArray(x.out)) return undefined;
  const out = x.out.map(id).filter((o): o is string => !!o);
  return { v: x.v as number, host, locked: x.locked, control: x.control, wait: x.wait, approve: x.approve, out: [...new Set(out)].slice(-OUT_MAX) };
}

/** A broadcast message, or null if it isn't one this version understands. */
export function parseMessage(x: unknown): PartyMessage | null {
  if (!isRecord(x)) return null;
  const from = id(x.from);
  if (!from) return null;
  switch (x.t) {
    case "ping":
      if (!finite(x.sent)) return null;
      return Number.isSafeInteger(x.seq) && (x.seq as number) > 0 ? { t: "ping", from, sent: x.sent, seq: x.seq as number } : { t: "ping", from, sent: x.sent };
    case "hello":
    case "bye":
      return { t: x.t, from };
    case "state": {
      // From someone other than its author it's passed on (the host's heartbeat, an answer to
      // a newcomer): room.ts decides whose it takes (`relayTakes`).
      const tl = parseTimeline(x.tl);
      if (!tl) return null;
      const noBy = isRecord(x.no) ? id(x.no.by) : undefined;
      const noV = isRecord(x.no) ? x.no.v : undefined;
      return noBy && Number.isSafeInteger(noV) && (noV as number) > 0 ? { t: "state", from, tl, no: { v: noV as number, by: noBy } } : { t: "state", from, tl };
    }
    case "rules": {
      const rules = parseRules(x.rules);
      return rules ? { t: "rules", from, rules } : null;
    }
    case "admit":
    case "kick":
    case "presence": {
      const to = id(x.to);
      return to ? { t: x.t, from, to } : null;
    }
    case "refuse": {
      const to = id(x.to);
      return to && (x.why === "locked" || x.why === "denied") ? { t: "refuse", from, to, why: x.why } : null;
    }
    case "end":
      return { t: "end", from };
    case "at": {
      const videoId = mediaId(x.videoId);
      if (!videoId || !finite(x.position) || typeof x.paused !== "boolean") return null;
      return { t: "at", from, videoId, position: clamp(x.position, 0, POSITION_MAX), paused: x.paused, lag: finite(x.lag) ? clamp(x.lag, 0, LAG_MAX) : 0 };
    }
    default:
      return null;
  }
}

/** A presence entry, or undefined. `key` is the presence key it was tracked under: the entry must carry it as its id. */
export function parseMember(x: unknown, key?: string): PartyPresence | undefined {
  if (!isRecord(x)) return undefined;
  const memberId = id(x.id);
  if (!memberId || (key !== undefined && key !== memberId) || !finite(x.joinedAt)) return undefined;
  return {
    id: memberId,
    name: text(x.name, NAME_MAX) ?? "Guest",
    avatar: normalizeAvatar(typeof x.avatar === "string" ? x.avatar : ""),
    joinedAt: x.joinedAt,
    waiting: x.waiting === true,
    ...(x.away === true ? { away: true } : {}),
    ...(x.buffering === true ? { buffering: true } : {}),
    ...(x.knock === true ? { knock: true } : {}),
    ...(Number.isSafeInteger(x.seq) && (x.seq as number) > 0 ? { seq: x.seq as number } : {}),
  };
}

/**
 * The room's member list from a presence state (key -> entries). A key can
 * hold more than one entry for a while (a reconnect's old one not yet
 * expired, an update whose old entry hasn't been dropped), in no promised
 * order: the highest `seq` is the member's newest, the last one if none has it.
 */
export function parsePresence(state: Record<string, unknown[]>): PartyPresence[] {
  const members: PartyPresence[] = [];
  for (const [key, metas] of Object.entries(state)) {
    if (!Array.isArray(metas)) continue;
    let newest: PartyPresence | undefined;
    for (const meta of metas) {
      const m = parseMember(meta, key);
      if (m && (!newest || (m.seq ?? 0) >= (newest.seq ?? 0))) newest = m;
    }
    if (newest) members.push(newest);
  }
  return members;
}

/**
 * Whether an incoming timeline replaces ours: newer by (version, author), from
 * someone in the room (the host, if only the host controls playback), and not
 * too far ahead unless it's the host's. `members`
 * is null until the first presence list has arrived (a joiner may hear the
 * timeline first).
 */
export function takesOver(
  cur: Pick<Timeline, "v" | "by"> | null,
  tl: Timeline,
  members: readonly { id: string }[] | null,
  hostId: string | null,
  hostOnly = false,
) {
  if (members && !members.some((m) => m.id === tl.by)) return false;
  // Only the host controls playback (#156): a member's action doesn't count, however new.
  if (hostOnly && hostId && tl.by !== hostId) return false;
  if (!cur) return true;
  if (tl.v < cur.v || (tl.v === cur.v && tl.by < cur.by)) return false;
  return tl.v - cur.v <= V_JUMP_MAX || tl.by === hostId;
}

/** A round trip from a ping's echo, in ms, or undefined if it can't be one (a forged ping). */
export function roundTrip(sent: number, now: number) {
  const rtt = now - sent;
  return rtt >= 0 && rtt <= LAG_MAX * 2000 ? rtt : undefined;
}
