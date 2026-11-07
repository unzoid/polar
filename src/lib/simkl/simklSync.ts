import { api } from "../api";
import { onLibraryToggle } from "../library/libraryEvents";
import { queryClient } from "../net/queryClient";
import { keys } from "../net/queryKeys";
import type { ContentType, LibraryItem, Progress } from "../types";
import { getSimklLink, saveSimklLink, type SimklLink } from "./link";
import { liveSimklLink, onSimklLinked, simklLinkChanged } from "./linking";
import { simklRefOf } from "./items";
import { forgetSimklSeen, noteSimklItem, pullSimkl, realSimklPullDeps, simklItems, type SimklPullResult } from "./pull";
import { clearSimklQueue, enqueueSimkl, flushSimkl, pendingSimklOps, type SimklFlushResult, type SimklOp } from "./queue";

/**
 * Keeps the active profile's Simkl account in step with Polarity (#86). Out: watched marks made by
 * hand, and episodes the player counted watched that Simkl's scrobble didn't, and, with the
 * watchlist switch on, titles added to or taken off the library go into the profile's queue
 * (queue.ts), which goes out when the profile starts, when the window or the network comes back,
 * and right after each change. In: what changed on Simkl (pull.ts), looked at when the profile
 * starts or links, and when the window comes back at most every quarter of an hour, as Simkl's
 * daily allowance is shared with the user's other apps.
 *
 * The active profile is the one sync runs for (lib/account/sync.ts); `null` is the device's own.
 */
export interface SimklSyncDeps {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  getLink: (space: string | null) => Promise<SimklLink | undefined>;
  liveLink: (space: string | null) => Promise<SimklLink | undefined>;
  flush: (space: string | null) => Promise<SimklFlushResult>;
  pull: (space: string | null, link: SimklLink) => Promise<SimklPullResult | null>;
  now: () => number;
}

/** Brings what Simkl changed into the library and progress, then shows them again. */
async function importChanges(library: LibraryItem[], progress: Progress[]) {
  await api.importLibrary(library, progress);
  for (const key of [keys.history, keys.continue, keys.progressAll, keys.library]) queryClient.invalidateQueries({ queryKey: key });
}

const realDeps = (): SimklSyncDeps => ({
  storage: localStorage,
  getLink: getSimklLink,
  liveLink: (space) => liveSimklLink(space),
  flush: (space) => flushSimkl(space),
  pull: (space, link) => pullSimkl(space, link, realSimklPullDeps(importChanges)),
  now: Date.now,
});

/** The window coming back looks at Simkl again only this long after the last look. */
const LOOK_EVERY = 15 * 60_000;

let deps: SimklSyncDeps | undefined;
const use = () => (deps ??= realDeps());

let space: string | null = null;
let sending: Promise<void> | null = null;
let again: false | true | "look" = false;
let lookedAt = -Infinity;

/** Tests: what the Simkl sync reads and calls instead of the real ones. */
export function setSimklSyncDeps(d: SimklSyncDeps | undefined) {
  deps = d;
  space = null;
  sending = null;
  again = false;
  lookedAt = -Infinity;
}

/** The profile sync now runs for (`null`: none, the device's own); its queue goes out and Simkl is looked at. */
export function setSimklSpace(next: string | null) {
  space = next;
  void syncSimkl(true);
}

export const simklSpace = () => space;

const usable = (link: SimklLink | undefined): link is SimklLink => !!link && !link.refused;

/**
 * Sends the active profile's queue and, with `look`, brings in what changed on Simkl. A call during
 * a round adds one more round after it, which the returned promise also waits for.
 */
export function syncSimkl(look = false): Promise<void> {
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
        if (pendingSimklOps(of, d.storage).length) await d.flush(of);
        if (!looking) continue;
        lookedAt = d.now();
        const link = await d.liveLink(of);
        if (link && of === space) await d.pull(of, link);
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

/**
 * A title added to (`true`) or removed from the library, when the profile keeps it in step with
 * Simkl: one Simkl doesn't list yet goes onto Plan to Watch; one taken off while still on Plan to
 * Watch leaves Simkl's lists. One Simkl lists elsewhere (watching, completed…) stays where it is.
 */
export async function noteSimklLibrary(item: { id: string; type: ContentType }, inLibrary: boolean): Promise<void> {
  const ref = simklRefOf(item.id, item.type);
  if (!ref || ref.kind === "episode") return;
  const d = use();
  const of = space;
  const link = await d.getLink(of);
  if (!link?.watchlist) return;
  const listed = simklItems(of, d.storage)[item.id];
  const kind = ref.kind === "movie" ? "movies" : "kitsu" in ref.ids ? "anime" : "shows";
  if (inLibrary && !listed) {
    noteSimklItem(of, item.id, { kind, status: "plantowatch" }, d.storage);
    await queue([{ list: "watchlist", ref, extra: { to: "plantowatch" } }]);
  } else if (!inLibrary && listed?.status === "plantowatch") {
    noteSimklItem(of, item.id, null, d.storage);
    await queue([{ list: "watchlist", remove: true, ref }]);
  }
}

/** Switches the profile's library ↔ Plan to Watch step on or off; on looks at Simkl at once. */
export async function setSimklWatchlist(
  of: string | null,
  on: boolean,
  deps: Pick<SimklSyncDeps, "getLink"> & { saveLink: typeof saveSimklLink } = { getLink: use().getLink, saveLink: saveSimklLink },
) {
  const link = await deps.getLink(of);
  if (!link) return;
  const next: SimklLink = { ...link };
  if (on) next.watchlist = true;
  else delete next.watchlist;
  await deps.saveLink(of, next);
  simklLinkChanged();
  if (on) void syncSimkl(true);
}

/** Unlinking drops what was still waiting, where Simkl was and its lists; linking sends what was queued meanwhile and looks. */
onSimklLinked((of, linked) => {
  if (!linked) {
    clearSimklQueue(of, use().storage);
    forgetSimklSeen(of, use().storage);
  } else void syncSimkl(true);
});

onLibraryToggle((item, inLibrary) => void noteSimklLibrary(item, inLibrary));

if (typeof window !== "undefined") {
  window.addEventListener("focus", () => void syncSimkl(use().now() - lookedAt > LOOK_EVERY));
  window.addEventListener("online", () => void syncSimkl());
}
