import { playContext, type ListEpisode } from "../anime/playContext";
import { storeLocal } from "../errors";
import { isRecord, num, storedJson } from "../parse";
import { readEntry } from "./anilistList";
import type { Caller, ListEntry } from "./entry";
import { getLink, LIST_SERVICES, type Link, type ListService } from "./linkStore";
import { enqueue, flush, pendingOps, type FlushResult } from "./queue";
import { listClient, liveLink } from "./services";

/**
 * Keeps the active profile's linked lists (#83 AniList, #84 MyAnimeList) in step with what is
 * watched in Polarity: an episode that passes the watched threshold, or is marked watched by hand,
 * goes into the profile's queue for each linked service (queue.ts), and the queues go out when the
 * profile starts, when the window comes back, when the network does, and right after each change.
 * On start it also asks each service what changed there since the last look, and keeps those
 * entries on the device for the anime page (never in Polarity's sync: the services' terms rule out
 * storing the list elsewhere).
 *
 * The active profile is the one sync runs for (lib/account/sync.ts); `null` is the device's own.
 */
const SEEN_MAX = 500;

export const entriesKey = (service: ListService, space: string | null) => `polar.lists.entries.${service}.${space ?? "local"}`;

interface Seen {
  /** The newest `updatedAt` seen, in seconds. */
  at: number;
  entries: Record<string, ListEntry>;
}

export interface ListSyncDeps {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  getLink: (service: ListService, space: string | null) => Promise<Link | undefined>;
  /** The link ready to use, refreshed first where it needs to be (services.ts). */
  liveLink: (service: ListService, space: string | null) => Promise<Link | undefined>;
  listEpisode: (videoId: string) => ListEpisode | undefined;
  flush: (service: ListService, space: string | null) => Promise<FlushResult>;
  changedSince: (service: ListService, userId: number, since: number, caller: Caller) => Promise<ListEntry[]>;
}

const realDeps = (): ListSyncDeps => ({
  storage: localStorage,
  getLink,
  liveLink: (service, space) => liveLink(service, space),
  listEpisode: (videoId) => playContext.listEpisode(videoId),
  flush: (service, space) => flush(service, space),
  changedSince: (service, ...args) => listClient(service).changedSince(...args),
});

/** The service's id of the anime an episode belongs to, when its page knew it. */
const idOn = (service: ListService, e: ListEpisode) => (service === "anilist" ? e.anilist : e.mal);

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

/** What this device last saw of the profile's entry for `mediaId` (the service's id) on `service`, if anything. */
export function seenEntry(service: ListService, mediaId: number, of: string | null = space): ListEntry | undefined {
  return readSeen(storedJson(use().storage, entriesKey(service, of))).entries[mediaId];
}

/** Hear when entries seen on a service change, or the profile they are read for does; returns the function that stops listening. */
export function onListEntries(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Drops what this device kept of the profile's list on `service` (unlinking). */
export function forgetListEntries(service: ListService, of: string | null) {
  use().storage.removeItem(entriesKey(service, of));
  listeners.forEach((l) => l());
}

/**
 * Keeps `entry` as the profile's entry for its anime on `service`, as changed from Polarity (or,
 * with `null`, drops `mediaId`'s), until the service's own answer replaces it.
 */
export function keepEntry(service: ListService, of: string | null, entry: ListEntry | null, mediaId = entry?.mediaId) {
  if (mediaId === undefined) return;
  const d = use();
  const seen = readSeen(storedJson(d.storage, entriesKey(service, of)));
  if (entry) seen.entries[mediaId] = entry;
  else delete seen.entries[mediaId];
  storeLocal(entriesKey(service, of), JSON.stringify(seen), d.storage);
  listeners.forEach((l) => l());
}

/** The profile sync now runs for (`null`: none, the device's own); its queues go out and its lists are looked at. */
export function setListSpace(next: string | null) {
  space = next;
  listeners.forEach((l) => l());
  void syncList(true);
}

/** The profile the list sync runs for. */
export const listSpace = () => space;

/**
 * Sends the active profile's queues and, with `look`, asks each linked service what changed there. A call made
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
      for (const service of LIST_SERVICES) {
        await round(service, space, looking).catch((e) =>
          console.warn(`${listClient(service).name}: the list could not be brought up to date`, e instanceof Error ? e.name : ""),
        );
      }
    }
  })().finally(() => {
    sending = null;
  });
  return sending;
}

async function round(service: ListService, of: string | null, look: boolean) {
  const d = use();
  if (!(await d.getLink(service, of))) return;
  if (pendingOps(service, of, d.storage).length) await d.flush(service, of);
  const link = look ? await d.liveLink(service, of) : undefined;
  if (link) await lookAtChanges(service, of, link, d);
}

async function lookAtChanges(service: ListService, of: string | null, link: Link, d: ListSyncDeps) {
  const seen = readSeen(storedJson(d.storage, entriesKey(service, of)));
  const changed = await d.changedSince(service, link.userId, seen.at, { token: link.token });
  if (of !== space || !changed.length) return;
  for (const e of changed) seen.entries[e.mediaId] = e;
  seen.at = Math.max(seen.at, ...changed.map((e) => e.updatedAt));
  const kept = Object.values(seen.entries)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, SEEN_MAX);
  storeLocal(entriesKey(service, of), JSON.stringify({ at: seen.at, entries: Object.fromEntries(kept.map((e) => [e.mediaId, e])) }), d.storage);
  listeners.forEach((l) => l());
}

/**
 * Videos just watched (past the threshold, or marked by hand), in the order watched: each one
 * whose anime page told which entry it is goes into the profile's queue of each service it has
 * linked, by that service's id, and the queues go out. Others (not anime, never lined up) are
 * left alone.
 */
export async function noteWatched(videoIds: string[]): Promise<void> {
  const d = use();
  const of = space;
  const episodes = videoIds.map(d.listEpisode).filter((e): e is ListEpisode => !!e);
  if (!episodes.length) return;
  let queued = false;
  for (const service of LIST_SERVICES) {
    if (!(await d.getLink(service, of))) continue;
    for (const e of episodes) {
      const mediaId = idOn(service, e);
      if (mediaId === undefined) continue;
      enqueue(service, of, { kind: "watched", mediaId, episode: e.episode, total: e.total }, d.storage);
      queued = true;
    }
  }
  if (queued) await syncList();
}

if (typeof window !== "undefined") {
  const wake = () => void syncList();
  window.addEventListener("focus", wake);
  window.addEventListener("online", wake);
  // The device's own list until a profile starts (setListSpace).
  void syncList(true);
}
