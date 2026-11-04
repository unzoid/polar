import { isReleased } from "../format";
import { watchedFraction } from "./watched";
import type { Meta, Progress, Video } from "../types";

/** Season numbers with regular seasons first and specials (0) last. */
export function seasonsOf(meta: Meta): number[] {
  const set = [...new Set(meta.videos.map((v) => v.season))];
  return set.sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b));
}

/** The episode after `videoId`, crossing into the next season. Specials are skipped unless you're in them. */
export function nextVideo(meta: Meta, videoId: string): Video | undefined {
  const i = meta.videos.findIndex((v) => v.id === videoId);
  if (i < 0) return undefined;
  const current = meta.videos[i];
  return meta.videos
    .slice(i + 1)
    .find((v) => (current.season === 0 ? v.season === 0 : v.season !== 0) && isReleased(v));
}

export interface UpNext {
  video?: Video;
  /** Resume point in seconds, if partially watched. */
  resumeAt?: number;
  kind: "start" | "resume" | "next";
}

/**
 * What the big button should do. Picks the most recently touched episode:
 * resume it if unfinished, otherwise move on to the one after it.
 */
export function upNext(meta: Meta, progress: Progress[]): UpNext {
  const latest = [...progress].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const firstRegular = meta.videos.find((v) => v.season > 0 && isReleased(v)) ?? meta.videos[0];

  if (!latest) return { video: firstRegular, kind: "start" };
  const video = meta.videos.find((v) => v.id === latest.videoId);
  if (!video) return { video: firstRegular, kind: "start" };

  const fraction = latest.duration ? latest.position / latest.duration : 0;
  if (fraction < watchedFraction()) {
    // Unfinished: resume it, or (barely started) play it again from the top.
    return latest.position > 30 ? { video, resumeAt: latest.position, kind: "resume" } : { video, kind: "next" };
  }
  const next = nextVideo(meta, video.id);
  return next ? { video: next, kind: "next" } : { video: firstRegular, kind: "start" };
}

export function progressMap(progress: Progress[] | undefined) {
  return new Map((progress ?? []).map((p) => [p.videoId, p]));
}
