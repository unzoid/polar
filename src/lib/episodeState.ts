import { isReleased } from "./format";
import type { Progress, Video } from "./types";

export type EpisodeState = {
  released: boolean;
  /** How far it's been played, 0..1 (0 when never). */
  fraction: number;
  watched: boolean;
  /** Started and not yet watched. */
  inProgress: boolean;
};

/**
 * An episode's state in a list (docs/ui-components.md U8): released, how far it's played, watched or under way.
 * `threshold` is `watchedFraction()`; passed in so this stays pure (and testable without the query cache).
 */
export function episodeState(video: Video, progress: Progress | undefined, threshold: number): EpisodeState {
  const fraction = progress?.duration ? progress.position / progress.duration : 0;
  const watched = fraction >= threshold;
  return { released: isReleased(video), fraction, watched, inProgress: fraction > 0 && !watched };
}
