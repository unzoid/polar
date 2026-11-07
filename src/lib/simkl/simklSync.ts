import type { ContentType } from "../types";
import { getSimklLink, type SimklLink } from "./link";
import { onSimklLinked } from "./linking";
import { simklRefOf } from "./items";
import { clearSimklQueue, enqueueSimkl, flushSimkl, pendingSimklOps, type SimklFlushResult, type SimklOp } from "./queue";

/**
 * Keeps the active profile's Simkl account in step with Polarity (#86). Out: watched marks made by
 * hand, and episodes the player counted watched that Simkl's scrobble didn't, go into the
 * profile's queue (queue.ts), which goes out when the profile starts, when the window or the
 * network comes back, and right after each change.
 *
 * The active profile is the one sync runs for (lib/account/sync.ts); `null` is the device's own.
 */
export interface SimklSyncDeps {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  getLink: (space: string | null) => Promise<SimklLink | undefined>;
  flush: (space: string | null) => Promise<SimklFlushResult>;
  now: () => number;
}

const realDeps = (): SimklSyncDeps => ({
  storage: localStorage,
  getLink: getSimklLink,
  flush: (space) => flushSimkl(space),
  now: Date.now,
});

let deps: SimklSyncDeps | undefined;
const use = () => (deps ??= realDeps());

let space: string | null = null;
let sending: Promise<void> | null = null;
let again = false;

/** Tests: what the Simkl sync reads and calls instead of the real ones. */
export function setSimklSyncDeps(d: SimklSyncDeps | undefined) {
  deps = d;
  space = null;
  sending = null;
  again = false;
}

/** The profile sync now runs for (`null`: none, the device's own); its queue goes out. */
export function setSimklSpace(next: string | null) {
  space = next;
  void syncSimkl();
}

export const simklSpace = () => space;

const usable = (link: SimklLink | undefined): link is SimklLink => !!link && !link.refused;

/** Sends the active profile's queue. A call during a round adds one more round after it, which the returned promise also waits for. */
export function syncSimkl(): Promise<void> {
  again = true;
  if (sending) return sending;
  sending = (async () => {
    while (again) {
      again = false;
      const d = use();
      const of = space;
      try {
        if (pendingSimklOps(of, d.storage).length && usable(await d.getLink(of))) await d.flush(of);
      } catch (e) {
        console.warn("Simkl: could not be brought up to date", e instanceof Error ? e.name : "");
      }
    }
  })().finally(() => {
    sending = null;
  });
  return sending;
}

export interface SimklWatchedVideo {
  videoId: string;
  type: ContentType;
}

async function queue(ops: SimklOp[]) {
  const d = use();
  const of = space;
  if (!ops.length || !usable(await d.getLink(of))) return;
  enqueueSimkl(of, ops, d.storage);
  await syncSimkl();
}

/**
 * Videos marked watched (`true`) or unwatched by hand, or counted watched by the player when
 * Simkl's scrobble didn't count them: queued for the profile's Simkl history, when it has linked
 * Simkl, and sent. Files on this device are left alone.
 */
export async function noteSimklWatched(videos: SimklWatchedVideo[], watched: boolean): Promise<void> {
  const at = new Date(use().now()).toISOString();
  const ops: SimklOp[] = [];
  for (const { videoId, type } of videos) {
    const ref = simklRefOf(videoId, type);
    if (!ref) continue;
    ops.push(watched ? { list: "history", ref, extra: { watched_at: at } } : { list: "history", remove: true, ref });
  }
  await queue(ops);
}

/** Unlinking drops what was still waiting; linking sends what was queued meanwhile. */
onSimklLinked((of, linked) => {
  if (!linked) clearSimklQueue(of, use().storage);
  else void syncSimkl();
});

if (typeof window !== "undefined") {
  window.addEventListener("focus", () => void syncSimkl());
  window.addEventListener("online", () => void syncSimkl());
}
