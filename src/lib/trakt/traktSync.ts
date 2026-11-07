import type { ContentType } from "../types";
import { getTraktLink } from "./link";
import { onTraktLinked } from "./linking";
import { traktRefOf } from "./items";
import { clearTraktQueue, enqueueTrakt, flushTrakt, pendingTraktOps, type TraktFlushResult, type TraktOp } from "./queue";

/**
 * Keeps the active profile's Trakt account in step with Polarity (#85): watched marks made by hand
 * (and episodes the player counted watched that Trakt's scrobble didn't) go into the profile's
 * queue (queue.ts), which goes out when the profile starts, when the window or the network comes
 * back, and right after each change.
 *
 * The active profile is the one sync runs for (lib/account/sync.ts); `null` is the device's own.
 */
export interface TraktSyncDeps {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  linked: (space: string | null) => Promise<boolean>;
  flush: (space: string | null) => Promise<TraktFlushResult>;
  now: () => number;
}

const realDeps = (): TraktSyncDeps => ({
  storage: localStorage,
  linked: async (space) => {
    const link = await getTraktLink(space);
    return !!link && !link.refused;
  },
  flush: (space) => flushTrakt(space),
  now: Date.now,
});

let deps: TraktSyncDeps | undefined;
const use = () => (deps ??= realDeps());

let space: string | null = null;
let sending: Promise<void> | null = null;
let again = false;

/** Tests: what the Trakt sync reads and calls instead of the real ones. */
export function setTraktSyncDeps(d: TraktSyncDeps | undefined) {
  deps = d;
  space = null;
  sending = null;
  again = false;
}

/** The profile sync now runs for (`null`: none, the device's own); its queue goes out. */
export function setTraktSpace(next: string | null) {
  space = next;
  void syncTrakt();
}

export const traktSpace = () => space;

/** Sends the active profile's queue; a call during a round adds one more round after it. */
export function syncTrakt(): Promise<void> {
  if (sending) {
    again = true;
    return sending;
  }
  again = true;
  sending = (async () => {
    while (again) {
      again = false;
      const d = use();
      const of = space;
      if (!pendingTraktOps(of, d.storage).length || !(await d.linked(of))) continue;
      await d.flush(of).catch(() => console.warn("Trakt: changes could not be sent"));
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

/**
 * Videos marked watched (`true`) or unwatched by hand, or counted watched by the player when
 * Trakt's scrobble didn't count them: queued for the profile's Trakt history, when it has linked
 * Trakt, and sent. Videos Trakt can't be told about (`kitsu:N`, local files) are left alone.
 */
export async function noteTraktWatched(videos: WatchedVideo[], watched: boolean): Promise<void> {
  const d = use();
  const of = space;
  if (!(await d.linked(of))) return;
  const at = new Date(d.now()).toISOString();
  const ops: TraktOp[] = [];
  for (const { videoId, type } of videos) {
    const ref = traktRefOf(videoId, type);
    if (!ref) continue;
    ops.push(watched ? { list: "history", ref, extra: { watched_at: at } } : { list: "history", remove: true, ref });
  }
  if (!ops.length) return;
  enqueueTrakt(of, ops, d.storage);
  await syncTrakt();
}

/** Unlinking drops what was still waiting; linking sends what was queued meanwhile. */
onTraktLinked((of, linked) => {
  if (!linked) clearTraktQueue(of, use().storage);
  else void syncTrakt();
});

if (typeof window !== "undefined") {
  const wake = () => void syncTrakt();
  window.addEventListener("focus", wake);
  window.addEventListener("online", wake);
}
