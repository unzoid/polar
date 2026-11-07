import { api } from "../api";
import { onLibraryToggle } from "../library/libraryEvents";
import { queryClient } from "../net/queryClient";
import { keys } from "../net/queryKeys";
import type { ContentType, LibraryItem, Progress } from "../types";
import { getTraktLink, saveTraktLink, type TraktLink } from "./link";
import { liveTraktLink, onTraktLinked, traktLinkChanged } from "./linking";
import { traktRefOf } from "./items";
import { forgetTraktSeen, pullTrakt, realPullDeps, type PullResult } from "./pull";
import { clearTraktQueue, enqueueTrakt, flushTrakt, pendingTraktOps, type TraktFlushResult, type TraktOp } from "./queue";

/**
 * Keeps the active profile's Trakt account in step with Polarity (#85). Out: watched marks made
 * by hand (and episodes the player counted watched that Trakt's scrobble didn't) and, with the
 * watchlist switch on, titles added to or removed from the library go into the profile's queue
 * (queue.ts), which goes out when the profile starts, when the window or the network comes back,
 * and right after each change. In: what changed on Trakt (pull.ts), looked at when the profile
 * starts or links, and when the window comes back at most every few minutes.
 *
 * The active profile is the one sync runs for (lib/account/sync.ts); `null` is the device's own.
 */
export interface TraktSyncDeps {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  getLink: (space: string | null) => Promise<TraktLink | undefined>;
  liveLink: (space: string | null) => Promise<TraktLink | undefined>;
  flush: (space: string | null) => Promise<TraktFlushResult>;
  pull: (space: string | null, link: TraktLink) => Promise<PullResult | null>;
  now: () => number;
}

/** Brings what Trakt changed into the library and progress, then shows them again. */
async function importChanges(library: LibraryItem[], progress: Progress[]) {
  await api.importLibrary(library, progress);
  for (const key of [keys.history, keys.continue, keys.progressAll, keys.library]) queryClient.invalidateQueries({ queryKey: key });
}

const realDeps = (): TraktSyncDeps => ({
  storage: localStorage,
  getLink: getTraktLink,
  liveLink: (space) => liveTraktLink(space),
  flush: (space) => flushTrakt(space),
  pull: (space, link) => pullTrakt(space, link, realPullDeps(importChanges)),
  now: Date.now,
});

/** The window coming back looks at Trakt again only this long after the last look. */
const LOOK_EVERY = 5 * 60_000;

let deps: TraktSyncDeps | undefined;
const use = () => (deps ??= realDeps());

let space: string | null = null;
let sending: Promise<void> | null = null;
let again: false | true | "look" = false;
let lookedAt = -Infinity;

/** Tests: what the Trakt sync reads and calls instead of the real ones. */
export function setTraktSyncDeps(d: TraktSyncDeps | undefined) {
  deps = d;
  space = null;
  sending = null;
  again = false;
  lookedAt = -Infinity;
}

/** The profile sync now runs for (`null`: none, the device's own); its queue goes out and Trakt is looked at. */
export function setTraktSpace(next: string | null) {
  space = next;
  void syncTrakt(true);
}

export const traktSpace = () => space;

const usable = (link: TraktLink | undefined): link is TraktLink => !!link && !link.refused;

/**
 * Sends the active profile's queue and, with `look`, brings in what changed on Trakt. A call during
 * a round adds one more round after it, which the returned promise also waits for.
 */
export function syncTrakt(look = false): Promise<void> {
  if (sending) {
    again = look || again === "look" ? "look" : true;
    return sending;
  }
  again = look ? "look" : true;
  sending = (async () => {
    while (again) {
      const looking = again === "look";
      again = false;
      const d = use();
      const of = space;
      if (!usable(await d.getLink(of))) continue;
      try {
        if (pendingTraktOps(of, d.storage).length) await d.flush(of);
        if (!looking) continue;
        lookedAt = d.now();
        const link = await d.liveLink(of);
        if (link && of === space) await d.pull(of, link);
      } catch (e) {
        console.warn("Trakt: could not be brought up to date", e instanceof Error ? e.name : "");
      }
    }
  })().finally(() => {
    sending = null;
  });
  return sending;
}

export interface WatchedVideo {
  videoId: string;
  type: ContentType;
}

async function queue(ops: TraktOp[]) {
  const d = use();
  const of = space;
  if (!ops.length || !usable(await d.getLink(of))) return;
  enqueueTrakt(of, ops, d.storage);
  await syncTrakt();
}

/**
 * Videos marked watched (`true`) or unwatched by hand, or counted watched by the player when
 * Trakt's scrobble didn't count them: queued for the profile's Trakt history, when it has linked
 * Trakt, and sent. Videos Trakt can't be told about (`kitsu:N`, local files) are left alone.
 */
export async function noteTraktWatched(videos: WatchedVideo[], watched: boolean): Promise<void> {
  const at = new Date(use().now()).toISOString();
  const ops: TraktOp[] = [];
  for (const { videoId, type } of videos) {
    const ref = traktRefOf(videoId, type);
    if (!ref) continue;
    ops.push(watched ? { list: "history", ref, extra: { watched_at: at } } : { list: "history", remove: true, ref });
  }
  await queue(ops);
}

/** A title added to (`true`) or removed from the library: onto or off the Trakt watchlist, when the profile keeps them in step. */
export async function noteTraktLibrary(item: { id: string; type: ContentType }, inLibrary: boolean): Promise<void> {
  const ref = traktRefOf(item.id, item.type);
  if (!ref) return;
  const link = await use().getLink(space);
  if (!link?.watchlist) return;
  await queue([inLibrary ? { list: "watchlist", ref } : { list: "watchlist", remove: true, ref }]);
}

/** Switches the profile's library ↔ watchlist step on or off; on looks at Trakt's watchlist at once. */
export async function setTraktWatchlist(of: string | null, on: boolean, deps: Pick<TraktSyncDeps, "getLink"> & { saveLink: typeof saveTraktLink } = { getLink: use().getLink, saveLink: saveTraktLink }) {
  const link = await deps.getLink(of);
  if (!link) return;
  const next: TraktLink = { ...link };
  if (on) next.watchlist = true;
  else delete next.watchlist;
  await deps.saveLink(of, next);
  traktLinkChanged();
  if (on) void syncTrakt(true);
}

/** Unlinking drops what was still waiting and where Trakt was; linking sends what was queued meanwhile and looks. */
onTraktLinked((of, linked) => {
  if (!linked) {
    clearTraktQueue(of, use().storage);
    forgetTraktSeen(of, use().storage);
  } else void syncTrakt(true);
});

onLibraryToggle((item, inLibrary) => void noteTraktLibrary(item, inLibrary));

if (typeof window !== "undefined") {
  window.addEventListener("focus", () => void syncTrakt(use().now() - lookedAt > LOOK_EVERY));
  window.addEventListener("online", () => void syncTrakt());
}
