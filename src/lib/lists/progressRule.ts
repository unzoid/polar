import type { EntryChange, ListEntry } from "./entry";

/**
 * What watching episode `episode` (its number within the list entry) changes on the entry
 * (#83, #84), or `null` when nothing does:
 * - not on the list, planned, paused or dropped: watching, with that progress;
 * - watching: progress moves up to the episode, never back;
 * - completed: watching it again (`REPEATING`), from that episode;
 * - the last episode (`total`): completed; a rewatch that ends counts one more `repeat`.
 */
export function afterWatching(entry: ListEntry | null, episode: number, total: number | null | undefined): EntryChange | null {
  if (!Number.isInteger(episode) || episode < 1) return null;
  const last = total != null && total > 0 && episode >= total;
  const progress = total != null && total > 0 ? Math.min(episode, total) : episode;
  if (!entry || entry.status === "PLANNING" || entry.status === "PAUSED" || entry.status === "DROPPED") {
    return last ? { status: "COMPLETED", progress } : { status: "CURRENT", progress: Math.max(progress, entry?.progress ?? 0) };
  }
  if (entry.status === "COMPLETED") {
    // The last episode again on its own (a finale rewatched) leaves a finished show finished.
    if (last) return null;
    return { status: "REPEATING", progress };
  }
  if (entry.status === "REPEATING") {
    if (last) return { status: "COMPLETED", progress, repeat: entry.repeat + 1 };
    return progress > entry.progress ? { progress } : null;
  }
  // CURRENT
  if (last) return { status: "COMPLETED", progress };
  return progress > entry.progress ? { progress } : null;
}
