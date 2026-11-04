import { episodeCode } from "./format";
import { usePlaylists } from "./playlists";
import { useLibrary, useMeta, useProgress, useToggleLibrary } from "./queries";
import type { MetaPreview, Progress } from "./types";
import { isWatched, markWatched, movieEntry, showEntries } from "./watched";

/**
 * What can be done with a title from its card (the TV options menu and the
 * desktop right-click menu): its watched state, progress, library and
 * playlists. `entry` is the progress the card stands for (Continue Watching,
 * Watched), which adds that one episode's own actions.
 */
export function useTitleActions(item: MetaPreview, entry?: Progress) {
  const { data: meta } = useMeta(item.type, item.id);
  const { data: progress } = useProgress(item.id);
  const { data: library } = useLibrary();
  const toggleLibrary = useToggleLibrary();
  const inPlaylist = usePlaylists().some((p) => p.items.some((i) => i.id === item.id));
  const inLibrary = !!library?.some((l) => l.id === item.id);
  const isSeries = item.type === "series";

  // Watched, for a movie: its own progress. For a show: every released episode.
  const entries = isSeries ? (meta ? showEntries(meta, progress) : undefined) : [movieEntry(item, progress, meta)];
  const allWatched = !!entries?.length && entries.every((p) => isWatched(p.position, p.duration));
  const played = (progress ?? []).filter((p) => p.position > 0);
  const episode = isSeries && entry && entry.season != null ? entry : undefined;
  const episodeUnwatched = !!episode && !isWatched(episode.position, episode.duration);
  /** The card's own video is part-way through (what Continue Watching shows). */
  const entryInProgress = !!entry && entry.position > 0 && !isWatched(entry.position, entry.duration);

  return {
    meta,
    isSeries,
    trailerYtId: meta?.trailerYtId,
    trailerSource: meta?.trailerSource,
    inLibrary,
    inPlaylist,
    toggleLibrary: () => toggleLibrary.mutate(item),
    /** "S2E4", for labels. */
    episodeLabel: episode ? episodeCode(episode.season, episode.episode) : undefined,
    episodeUnwatched,
    markEpisodeWatched: () => episode && void markWatched([episode], true),
    /** The card's episode is finished: offer to take it back. */
    episodeWatched: !!episode && !episodeUnwatched,
    markEpisodeUnwatched: () => episode && void markWatched([episode], false),
    allWatched,
    /** A show's episodes wait for its episode list. */
    canToggleWatched: !!entries?.length,
    toggleWatched: () => {
      if (!entries) return;
      // Unwatching only touches what's been played, ending on the last
      // episode so the show starts over from the top.
      const rows = allWatched ? entries.filter((p, i) => p.updatedAt > 0 || i === entries.length - 1) : entries;
      void markWatched(rows, !allWatched);
    },
    /** Anything played at all, finished or not. */
    hasProgress: played.length > 0,
    entryInProgress,
    /**
     * Take the card's video back to the start, which also takes it out of
     * Continue Watching. The rest of the title's history stays.
     */
    resetEntry: () => entry && void markWatched([entry], false),
    /** Forget every bit of the title's progress: it plays from the very start again. */
    resetAll: () => {
      if (!played.length) return;
      // Oldest first, so the newest reset is the one Continue Watching looks at.
      const rows = [...played].sort((a, b) => a.updatedAt - b.updatedAt);
      // A show ends on its last episode, so Play starts over from the top.
      const last = isSeries ? entries?.[entries.length - 1] : undefined;
      if (last) rows.splice(0, rows.length, ...rows.filter((p) => p.videoId !== last.videoId), last);
      void markWatched(rows, false);
    },
  };
}
