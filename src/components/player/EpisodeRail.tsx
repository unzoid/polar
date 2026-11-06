import { useLayoutEffect, useRef } from "react";
import { episodeState, watchedFraction } from "../../lib/library";
import { formatDate, formatRemaining, shortRuntime } from "../../lib/format";
import type { Meta, Progress, Video } from "../../lib/types";
import { DownloadButton } from "../DownloadButton";
import { buttonClass } from "../ui/Button";
import { Check, Play } from "../icons";
import { Img } from "../Img";
import { StillPlaceholder } from "../StillPlaceholder";

/**
 * The player's Episodes, as a streaming app lays them out: a season's episodes side by side, each
 * a still with its number and title, Download, its length and synopsis. The one playing is marked
 * and scrolled into view; picking another plays it (the season is chosen above, in the column's head).
 */
export function EpisodeRail({
  meta,
  episodes,
  playing,
  progress,
  still,
  onPlay,
}: {
  meta: Meta;
  episodes: Video[];
  playing: string;
  progress: Map<string, Progress>;
  /** The best still known for an episode (an anime's come from elsewhere). */
  still: (v: Video) => string | undefined;
  onPlay: (id: string) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);

  // Open on the episode that's playing (or the season's start), without animating the jump.
  useLayoutEffect(() => {
    const el = rail.current;
    const card = el?.querySelector<HTMLElement>('[aria-current="true"]');
    // The rail is the cards' offset parent (position: relative); snapping lines the card up exactly.
    if (el) el.scrollLeft = card?.offsetLeft ?? 0;
  }, [episodes]);

  if (!episodes.length) return <p className="options-empty">No episodes in this season yet.</p>;

  return (
    <div className="episode-rail" ref={rail}>
      {episodes.map((v) => {
        const p = progress.get(v.id);
        const { released, fraction, watched, inProgress } = episodeState(v, p, watchedFraction());
        const current = v.id === playing;
        const length = inProgress && p ? formatRemaining(p.position, p.duration) : shortRuntime(meta.runtime);
        return (
          <article key={v.id} className="episode-rail-card" aria-current={current || undefined} data-unwatched={!watched}>
            <button
              className="episode-rail-main"
              disabled={!released || current}
              onClick={() => onPlay(v.id)}
              aria-label={`${v.episode}. ${v.title}${current ? ", playing" : ""}`}
            >
              <span className="episode-rail-still">
                {still(v) ? <Img src={still(v)} alt="" /> : <StillPlaceholder />}
                {!current && released && (
                  <span className="episode-rail-play" aria-hidden>
                    <Play size={20} fill="currentColor" strokeWidth={0} />
                  </span>
                )}
                {current && <span className="episode-rail-now t-micro">Playing</span>}
                {watched && !current && (
                  <span className="episode-rail-watched" aria-label="Watched">
                    <Check size={12} strokeWidth={3} />
                  </span>
                )}
                {!watched && fraction > 0 && (
                  <span className="progress-track" aria-hidden>
                    <span className="progress-fill" style={{ transform: `scaleX(${fraction})` }} />
                  </span>
                )}
              </span>
              <span className="episode-rail-title">
                {v.episode}. {v.title}
              </span>
            </button>
            {released && <DownloadButton item={meta} video={v} className={buttonClass("plain", true, "episode-rail-download pressable")} size={20} />}
            <p className="episode-rail-meta t-callout tabular">{released ? length : `Coming ${formatDate(v.released)}`}</p>
            {v.overview && <p className="episode-rail-overview t-callout">{v.overview}</p>}
          </article>
        );
      })}
    </div>
  );
}
