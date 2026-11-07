/**
 * Friend codes and what arrives from friends (#135), checked before use.
 *
 * A friend's presence and an invite come from another account: every entry is
 * parsed here, wrong shapes dropped and text cut to size. Pure, so it's tested
 * without a server (tests/friends.test.ts).
 */
import type { FriendPresence, FriendPrivacy } from "../account/backend";
import { contentType, isRecord } from "../parse";

/** Eight characters, without the look-alikes 0/O and 1/I (the server makes them). */
export const FRIEND_CODE_LENGTH = 8;
const CODE_CHARS = /[^2-9A-HJ-NP-Z]/g;

/**
 * A friend code from what was typed or pasted: "abcd-2345", "ABCD 2345", or a
 * link ending in the code. An O or I typed for 0 or 1 still can't match.
 */
export function normalizeFriendCode(input: string) {
  const last = input.trim().split(/[/=]/).pop() ?? "";
  return last.toUpperCase().replace(CODE_CHARS, "").slice(0, FRIEND_CODE_LENGTH);
}

/** "ABCD-2345": easier to read out and type. */
export const formatFriendCode = (code: string) => (code.length === FRIEND_CODE_LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code);

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PARTY = /^[A-Z0-9]{6}$/;
const TITLE_MAX = 120;
const LABEL_MAX = 60;
const MEDIA_ID_MAX = 200;

/** Short text with no control characters, or undefined. */
function text(x: unknown, max: number): string | undefined {
  if (typeof x !== "string") return undefined;
  const s = x.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return s ? s.slice(0, max) : undefined;
}

const mediaId = (x: unknown) =>
  typeof x === "string" && x.length > 0 && x.length <= MEDIA_ID_MAX && /^[^\s\u0000-\u001f\u007f]+$/.test(x) ? x : undefined;

/** One presence entry of the friend `friendId`; undefined when it isn't theirs or isn't one. */
export function parseFriendPresence(x: unknown, friendId: string): FriendPresence | undefined {
  if (!isRecord(x) || x.id !== friendId) return undefined;
  const seq = Number.isSafeInteger(x.seq) && (x.seq as number) > 0 ? (x.seq as number) : 0;
  const out: FriendPresence = { id: friendId, seq };
  if (typeof x.party === "string" && PARTY.test(x.party)) out.party = x.party;
  const w = x.watching;
  if (isRecord(w)) {
    const type = contentType(w.type);
    const metaId = mediaId(w.metaId);
    const title = text(w.title, TITLE_MAX);
    if (type && metaId && title) out.watching = { type, metaId, title, ...(text(w.label, LABEL_MAX) ? { label: text(w.label, LABEL_MAX) } : {}) };
  }
  return out;
}

/** A friend's topic's presence state (key -> entries): their newest entry, or `null` when they show none. */
export function friendFromState(state: Record<string, unknown[]>, friendId: string): FriendPresence | null {
  const metas = state[friendId];
  if (!Array.isArray(metas)) return null;
  let newest: FriendPresence | null = null;
  for (const meta of metas) {
    const p = parseFriendPresence(meta, friendId);
    if (p && (!newest || p.seq >= newest.seq)) newest = p;
  }
  return newest;
}

/** An invite broadcast: who from (a profile id) and the party's code. */
export function parseInvite(x: unknown): { from: string; party: string } | undefined {
  if (!isRecord(x) || typeof x.from !== "string" || !ID.test(x.from) || typeof x.party !== "string" || !PARTY.test(x.party)) return undefined;
  return { from: x.from, party: x.party };
}

export const isProfileId = (x: string) => ID.test(x);

/** This profile's presence for its friends, or `null` when it shows them nothing. */
export function ownPresence(
  id: string,
  seq: number,
  privacy: FriendPrivacy,
  party: string | null,
  watching: FriendPresence["watching"] | null,
): FriendPresence | null {
  if (!privacy.online) return null;
  return {
    id,
    seq,
    ...(privacy.join && party ? { party } : {}),
    ...(privacy.watching && watching ? { watching } : {}),
  };
}

/** Same as far as friends can tell (`seq` aside): no need to send it again. */
export function samePresence(a: FriendPresence | null, b: FriendPresence | null) {
  if (!a || !b) return a === b;
  const w = (p: FriendPresence) => (p.watching ? [p.watching.type, p.watching.metaId, p.watching.title, p.watching.label ?? ""].join("\n") : "");
  return a.id === b.id && a.party === b.party && w(a) === w(b);
}

/** A friend's line under their name, worded the same on every screen. */
export function friendStatus(p: FriendPresence | null | undefined): string {
  if (!p) return "Offline";
  const what = p.watching ? [p.watching.title, p.watching.label].filter(Boolean).join(" · ") : "";
  if (p.party) return what ? `In a watch party · ${what}` : "In a watch party";
  return what ? `Watching ${what}` : "Online";
}

/** Friends to list first: in a party, then watching, then online, then offline; by name within each. */
export function friendRank(p: FriendPresence | null | undefined) {
  return !p ? 3 : p.party ? 0 : p.watching ? 1 : 2;
}

/** Joining a friend's party: said until the host has let this profile in. */
export function joiningText(party: { knocking: boolean; rules: { approve?: boolean } } | null) {
  if (!party?.knocking) return null;
  return party.rules.approve ? "Waiting for the host to let you in…" : "Joining the watch party…";
}
