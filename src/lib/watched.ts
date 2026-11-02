import { keys, queryClient } from "./queries";
import type { Settings } from "./types";

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
