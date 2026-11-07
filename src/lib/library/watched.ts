import { api } from "../api";
import { sync } from "../account/sync";
import { isReleased, runtimeSeconds } from "../format";
import { noteWatched } from "../lists/listSync";
import { noteSimklWatched } from "../simkl/simklSync";
import { noteTraktWatched } from "../trakt/traktSync";
import { keys, queryClient } from "../net/queries";
import type { Meta, MetaPreview, Progress, Settings, Video } from "../types";

/**
 * How much of a video has to be watched before it counts as watched
 * (Settings → Playback), as a fraction. Read at call time from the settings
 * cache, so every list agrees with the player without threading it through.
 */
export function watchedFraction() {
  const percent = queryClient.getQueryData<Settings>(keys.settings)?.watchedThreshold ?? 92;
  return Math.min(100, Math.max(50, percent)) / 100;
}

export const isWatched = (position: number, duration: number) => duration > 0 && position / duration >= watchedFraction();


/** A progress entry for a video that hasn't been played yet. */
function blank(item: MetaPreview, videoId: string, duration: number, extra: Partial<Progress> = {}): Progress {
  return {
    metaId: item.id,
    videoId,
    type: item.type,
    name: item.name,
    background: item.background,
    poster: item.poster,
    position: 0,
    duration,
    updatedAt: 0,
    ...extra,
  };
}

/** The movie's own entry: what's been played of it, or a fresh one. */
export function movieEntry(item: MetaPreview, progress: Progress[] | undefined, meta?: Meta): Progress {
  return progress?.find((p) => p.videoId === item.id) ?? blank(item, item.id, runtimeSeconds(meta?.runtime));
}

/** Every released episode of a show (specials aside), in order, with what's been played of each. */
export function showEntries(meta: Meta, progress: Progress[] | undefined): Progress[] {
  const played = new Map((progress ?? []).map((p) => [p.videoId, p]));
  const duration = runtimeSeconds(meta.runtime);
  return meta.videos
    .filter((v) => v.season > 0 && isReleased(v))
    .map(
      (v) =>
        played.get(v.id) ??
        blank(meta, v.id, duration, { season: v.season, episode: v.episode, episodeTitle: v.title }),
    );
}

/** One episode's entry: what's been played of it, or a fresh one. */
export function episodeEntry(meta: Meta, video: Video, progress?: Progress): Progress {
  return (
    progress ??
    blank(meta, video.id, runtimeSeconds(meta.runtime), { season: video.season, episode: video.episode, episodeTitle: video.title })
  );
}

/**
 * Mark videos watched (at their end) or unwatched (back to the start). Saved
 * in the order given, so the last counts as the latest: give a show's
 * episodes in order and its Play button lands on the right one afterwards.
 */
export async function markWatched(entries: Progress[], watched: boolean) {
  if (!entries.length) return;
  const rows = entries.map((p) => {
    // An unplayed video has no known length; any will do for "all of it".
    const duration = p.duration > 0 ? p.duration : 1;
    return { ...p, duration, position: watched ? duration : 0, updatedAt: 0 };
  });
  await api.saveProgressMany(rows);
  for (const id of new Set(rows.map((r) => r.metaId))) queryClient.invalidateQueries({ queryKey: keys.progress(id) });
  queryClient.invalidateQueries({ queryKey: keys.continue });
  queryClient.invalidateQueries({ queryKey: keys.history });
  sync.schedule();
  // A linked AniList list hears of episodes marked watched by hand too (#83).
  if (watched) void noteWatched(rows.map((r) => r.videoId));
  // And a linked Trakt (#85) or Simkl (#86) account's history, both ways.
  const videos = rows.map((r) => ({ videoId: r.videoId, type: r.type }));
  void noteTraktWatched(videos, watched);
  void noteSimklWatched(videos, watched);
}
