import { playContext, type ListEpisode } from "../anime/playContext";
import { storeLocal } from "../errors";
import { isRecord, num, storedJson } from "../parse";
import { changedSince, readEntry, type Caller, type ListEntry } from "./anilistList";
import { getLink, usable, type Link } from "./linkStore";
import { enqueue, flush, pendingOps, type FlushResult } from "./queue";

/**
 * Keeps the active profile's linked AniList list in step with what is watched in Polarity (#83):
 * an episode that passes the watched threshold, or is marked watched by hand, goes into the
 * profile's queue (queue.ts), and the queue goes out when the profile starts, when the window
 * comes back, when the network does, and right after each change. On start it also asks AniList
 * what changed there since the last look, and keeps those entries on the device for the anime
 * page (never in Polarity's sync: AniList's terms rule out storing the list elsewhere).
 *
 * The active profile is the one sync runs for (lib/account/sync.ts); `null` is the device's own.
 */
const SEEN_MAX = 500;

export const entriesKey = (space: string | null) => `polar.lists.entries.anilist.${space ?? "local"}`;

interface Seen {
  /** The newest `updatedAt` seen, in seconds. */
  at: number;
  entries: Record<string, ListEntry>;
}

export interface ListSyncDeps {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  now: () => number;
  getLink: (space: string | null) => Promise<Link | undefined>;
  listEpisode: (videoId: string) => ListEpisode | undefined;
  flush: (space: string | null) => Promise<FlushResult>;
  changedSince: (userId: number, since: number, caller: Caller) => Promise<ListEntry[]>;
}

const realDeps = (): ListSyncDeps => ({
  storage: localStorage,
  now: Date.now,
  getLink: (space) => getLink("anilist", space),
  listEpisode: (videoId) => playContext.listEpisode(videoId),
  flush: (space) => flush(space),
  changedSince,
});

let deps: ListSyncDeps | undefined;
const use = () => (deps ??= realDeps());

/** Tests: what the list sync reads and calls instead of the real ones. */
export function setListSyncDeps(d: ListSyncDeps | undefined) {
  deps = d;
  space = null;
  sending = null;
  again = false;
}

let space: string | null = null;
let sending: Promise<void> | null = null;
/** Another round is due after this one; `"look"`: one that also asks what changed. */
let again: false | true | "look" = false;
const listeners = new Set<() => void>();

function readSeen(v: unknown): Seen {
  if (!isRecord(v)) return { at: 0, entries: {} };
  const entries: Record<string, ListEntry> = {};
  for (const e of Object.values(isRecord(v.entries) ? v.entries : {})) {
    const entry = readEntry(e);
    if (entry) entries[entry.mediaId] = entry;
  }
  return { at: num(v.at) ?? 0, entries };
}

/** What this device last saw of the profile's AniList entry for `mediaId`, if anything. */
export function seenEntry(mediaId: number, of: string | null = space): ListEntry | undefined {
  return readSeen(storedJson(use().storage, entriesKey(of))).entries[mediaId];
}

/** Hear when entries seen on AniList change, or the profile they are read for does; returns the function that stops listening. */
export function onListEntries(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Drops what this device kept of the profile's list (unlinking). */
export function forgetListEntries(of: string | null) {
  use().storage.removeItem(entriesKey(of));
  listeners.forEach((l) => l());
}

/**
 * Keeps `entry` as the profile's entry for its anime, as changed from Polarity (or, with `null`,
 * drops `mediaId`'s), until AniList's own answer replaces it.
 */
export function keepEntry(of: string | null, entry: ListEntry | null, mediaId = entry?.mediaId) {
  if (mediaId === undefined) return;
  const d = use();
  const seen = readSeen(storedJson(d.storage, entriesKey(of)));
  if (entry) seen.entries[mediaId] = entry;
  else delete seen.entries[mediaId];
  storeLocal(entriesKey(of), JSON.stringify(seen), d.storage);
  listeners.forEach((l) => l());
}

/** The profile sync now runs for (`null`: none, the device's own); its queue goes out and its list is looked at. */
export function setListSpace(next: string | null) {
  space = next;
  listeners.forEach((l) => l());
  void syncList(true);
}

/** The profile the list sync runs for. */
export const listSpace = () => space;

/**
 * Sends the active profile's queue and, with `look`, asks AniList what changed there. A call made
 * during a round adds one more round after it, which the returned promise also waits for, so
 * nothing queued or switched to meanwhile waits for the next wake.
 */
export function syncList(look = false): Promise<void> {
  if (sending) {
    again = look || again === "look" ? "look" : true;
    return sending;
  }
  again = look ? "look" : true;
  sending = (async () => {
    while (again) {
      const looking = again === "look";
      again = false;
      await round(space, looking).catch((e) => console.warn("AniList: the list could not be brought up to date", e instanceof Error ? e.name : ""));
    }
  })().finally(() => {
    sending = null;
  });
  return sending;
}

async function round(of: string | null, look: boolean) {
  const d = use();
  const link = await d.getLink(of);
  if (!link) return;
  if (pendingOps(of, d.storage).length) await d.flush(of);
  if (look && usable(link, d.now())) await lookAtChanges(of, link, d);
}

async function lookAtChanges(of: string | null, link: Link, d: ListSyncDeps) {
  const seen = readSeen(storedJson(d.storage, entriesKey(of)));
  const changed = await d.changedSince(link.userId, seen.at, { token: link.token });
  if (of !== space || !changed.length) return;
  for (const e of changed) seen.entries[e.mediaId] = e;
  seen.at = Math.max(seen.at, ...changed.map((e) => e.updatedAt));
  const kept = Object.values(seen.entries)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, SEEN_MAX);
  storeLocal(entriesKey(of), JSON.stringify({ at: seen.at, entries: Object.fromEntries(kept.map((e) => [e.mediaId, e])) }), d.storage);
  listeners.forEach((l) => l());
}

/**
 * Videos just watched (past the threshold, or marked by hand), in the order watched: each one
 * whose anime page told which AniList entry it is goes into the profile's queue, when the profile
 * has linked AniList, and the queue goes out. Others (not anime, never lined up) are left alone.
 */
export async function noteWatched(videoIds: string[]): Promise<void> {
  const d = use();
  const of = space;
  const episodes = videoIds.map(d.listEpisode).filter((e): e is ListEpisode => !!e);
  if (!episodes.length || !(await d.getLink(of))) return;
  for (const e of episodes) enqueue(of, { kind: "watched", mediaId: e.anilist, episode: e.episode, total: e.total }, d.storage);
  await syncList();
}

if (typeof window !== "undefined") {
  const wake = () => void syncList();
  window.addEventListener("focus", wake);
  window.addEventListener("online", wake);
  // The device's own list until a profile starts (setListSpace).
  void syncList(true);
}
