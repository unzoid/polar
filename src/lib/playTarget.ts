import { upNext } from "./episodes";
import { episodeCode, formatTime } from "./format";
import { useProgress } from "./queries";
import type { Meta, MetaPreview } from "./types";

/**
 * What a title's primary button plays, and what it says: the movie (resuming
 * if you're partway in), or a series' next episode by your watch history.
 */
export function usePlayTarget(item: MetaPreview, meta?: Meta) {
  const { data: progress } = useProgress(item.id);
  const isSeries = item.type === "series";

  const next = meta && isSeries ? upNext(meta, progress ?? []) : undefined;
  const movieProgress = !isSeries ? progress?.find((p) => p.videoId === item.id) : undefined;
  const videoId = isSeries ? next?.video?.id : item.id;
  const resumeAt = isSeries
    ? next?.resumeAt
    : movieProgress && movieProgress.position > 30 && movieProgress.position / movieProgress.duration < 0.92
      ? movieProgress.position
      : undefined;

  const label = (() => {
    if (!isSeries) return resumeAt ? `Resume · ${formatTime(resumeAt)}` : "Play";
    if (!next?.video) return "Play";
    const code = episodeCode(next.video.season, next.video.episode);
    if (next.kind === "resume") return `Resume ${code}`;
    if (next.kind === "next") return `Play ${code}`;
    return next.video.season === 1 && next.video.episode === 1 ? "Play First Episode" : `Play ${code}`;
  })();

  return { next, videoId, resumeAt, label };
}
