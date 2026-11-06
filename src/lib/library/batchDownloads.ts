import { useSyncExternalStore } from "react";
import type { MetaPreview, RankedStream, Video } from "../types";
import type { DownloadState } from "./downloads";

/**
 * A whole season or show downloaded as one batch (#24): one episode at a time, in order, each
 * taking the first source that can be downloaded, found only when its turn comes (links from
 * add-ons can expire while they wait). Episodes already downloaded are skipped; one already coming
 * down is waited for. The batch pauses, resumes and cancels as a whole: pausing pauses the episode
 * coming down, cancelling removes it (finished ones stay). Kept while the app runs.
 */

export type BatchState = "running" | "paused" | "finished" | "cancelled";

export interface Batch {
  key: string;
  state: BatchState;
  total: number;
  /** Downloaded, by this batch or before it. */
  done: number;
  /** Episodes with no source that could be downloaded, or whose download failed. */
  failed: number;
  /** The episode coming down now, and how far it is (0–1, when known). */
  current?: string;
  fraction?: number;
}

/** What the runner needs from the app; tests pass their own. */
export interface BatchDeps {
  /** The ranked sources of one episode. */
  sources(video: Video): Promise<RankedStream[]>;
  /** Starts a download; resolves with why it couldn't, or null. */
  start(item: MetaPreview, video: Video, pick: RankedStream): Promise<string | null>;
  /** Where a download stands, and how far it is. */
  status(id: string): Promise<{ state: DownloadState; fraction?: number } | undefined>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  sleep(ms: number): Promise<void>;
}

const batches = new Map<string, Batch>();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const put = (b: Batch) => {
  batches.set(b.key, { ...b });
  for (const l of listeners) l();
};

/** A batch by key (`<show id>` or `<show id>:<season>`), while the app runs. */
export const batchFor = (key: string) => batches.get(key);
export const useBatch = (key: string) => useSyncExternalStore(subscribe, () => batches.get(key));

/** The key of a season's batch, or the show's. */
export const batchKey = (showId: string, season?: number) => (season === undefined ? showId : `${showId}:${season}`);

export function pauseBatch(key: string) {
  const b = batches.get(key);
  if (b?.state === "running") put({ ...b, state: "paused" });
}
export function resumeBatch(key: string) {
  const b = batches.get(key);
  if (b?.state === "paused") put({ ...b, state: "running" });
}
export function cancelBatch(key: string) {
  const b = batches.get(key);
  if (b && (b.state === "running" || b.state === "paused")) put({ ...b, state: "cancelled" });
}

const POLL_MS = 1000;

/**
 * Downloads `videos` of `item` as the batch `key`. Starting a batch that's running or paused does
 * nothing; a finished or cancelled one starts over (skipping what's downloaded).
 */
export async function runBatch(key: string, item: MetaPreview, videos: Video[], deps: BatchDeps): Promise<Batch> {
  const running = batches.get(key);
  if (running && (running.state === "running" || running.state === "paused")) return running;
  let b: Batch = { key, state: "running", total: videos.length, done: 0, failed: 0 };
  put(b);
  const now = () => batches.get(key)!;
  const update = (patch: Partial<Batch>) => put((b = { ...now(), ...patch }));

  /** Waits out a pause; false once cancelled. */
  const go = async (current?: string) => {
    if (now().state === "paused" && current) await deps.pause(current);
    while (now().state === "paused") await deps.sleep(POLL_MS);
    if (now().state === "cancelled") return false;
    return true;
  };

  for (const video of videos) {
    if (!(await go())) break;
    const before = await deps.status(video.id);
    if (before?.state === "done") {
      update({ done: now().done + 1 });
      continue;
    }
    if (!before || before.state === "failed") {
      const pick = (await deps.sources(video).catch(() => [])).find((s) => !!s.stream.url && !s.otherEpisode);
      const why = pick ? await deps.start(item, video, pick) : "no source";
      if (why) {
        update({ failed: now().failed + 1 });
        continue;
      }
    } else if (before.state === "paused") {
      await deps.resume(video.id);
    }
    update({ current: video.id, fraction: undefined });

    // Coming down: follow it, pausing and resuming it with the batch.
    let ended = false;
    for (;;) {
      const s = await deps.status(video.id);
      if (!s || s.state === "failed" || s.state === "done") {
        ended = true;
        update(s?.state === "done" ? { done: now().done + 1, current: undefined, fraction: undefined } : { failed: now().failed + 1, current: undefined });
        break;
      }
      update({ fraction: s.fraction });
      if (now().state === "paused") {
        await deps.pause(video.id);
        if (!(await go())) break;
        await deps.resume(video.id);
      }
      if (now().state === "cancelled") break;
      await deps.sleep(POLL_MS);
      if (now().state === "cancelled") break;
    }
    if (now().state === "cancelled") {
      if (!ended) await deps.remove(video.id);
      update({ current: undefined, fraction: undefined });
      break;
    }
  }
  if (now().state !== "cancelled") update({ state: "finished", current: undefined, fraction: undefined });
  return now();
}

/** The whole batch's progress, 0–1: finished episodes plus the one coming down. */
export const batchFraction = (b: Batch) => (b.total ? Math.min(1, (b.done + b.failed + (b.fraction ?? 0)) / b.total) : 0);
