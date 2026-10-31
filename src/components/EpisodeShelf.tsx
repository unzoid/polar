import { Check, ListVideo, Play } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { formatDate, formatRemaining, isReleased } from "../lib/format";
import { prefetchStreams } from "../lib/queries";
import type { Progress, Video } from "../lib/types";
import { Img } from "./Img";
import { ProgressBar } from "./PosterCard";
import { Row } from "./Row";

/**
 * A season as a horizontal shelf of episode lockups (tvOS): still with a
 * "▶ 42m" label, then EPISODE N, title, a three-line synopsis and the airdate.
 * Opens scrolled to the episode you're up to.
 */
export function EpisodeShelf({
  episodes,
  progress,
  runtime,
  upNextId,
  onPlay,
  onSources,
}: {
  episodes: Video[];
  progress: Map<string, Progress>;
  runtime?: string;
  upNextId?: string;
  onPlay: (v: Video) => void;
  onSources: (v: Video) => void;
}) {
  const shelf = useRef<HTMLDivElement>(null);

  // Jump (no animation) so "up next" is the first card in view.
  useLayoutEffect(() => {
    const scroller = shelf.current?.querySelector<HTMLElement>(".row-scroller");
    if (!scroller) return;
    const el = upNextId ? scroller.querySelector<HTMLElement>(`[data-video="${CSS.escape(upNextId)}"]`) : null;
    const pad = parseFloat(getComputedStyle(scroller).paddingLeft);
    scroller.scrollLeft = el ? el.offsetLeft - pad : 0;
  }, [episodes, upNextId]);

  return (
    <div ref={shelf}>
      <Row shape="episode">
        {episodes.map((v) => (
          <EpisodeCard
            key={v.id}
            video={v}
            progress={progress.get(v.id)}
            runtime={runtime}
            upNext={v.id === upNextId}
            onPlay={onPlay}
            onSources={onSources}
          />
        ))}
      </Row>
    </div>
  );
}

/** "49 min" → "49m" */
const shortRuntime = (r?: string) => r?.replace(/\s*min$/, "m");

function EpisodeCard({
  video: v,
  progress: p,
  runtime,
  upNext,
  onPlay,
  onSources,
}: {
  video: Video;
  progress?: Progress;
  runtime?: string;
  upNext: boolean;
  onPlay: (v: Video) => void;
  onSources: (v: Video) => void;
}) {
  const released = isReleased(v);
  const fraction = p?.duration ? p.position / p.duration : 0;
  const watched = fraction >= 0.92;
  const inProgress = fraction > 0 && !watched;
  const timer = useRef<number>(undefined);

  // Resting on an episode is intent to watch it — warm its sources.
  const intent = {
    onPointerEnter: () => {
      if (released) timer.current = window.setTimeout(() => prefetchStreams("series", v.id), 150);
    },
    onPointerLeave: () => window.clearTimeout(timer.current),
  };

  const label = inProgress && p ? formatRemaining(p.position, p.duration) : shortRuntime(runtime);

  return (
    <div className="episode-card" data-video={v.id} data-up-next={upNext} data-unreleased={!released}>
      <button className="card card-landscape episode-card-main" disabled={!released} onClick={() => onPlay(v)} {...intent}>
        <div className="card-frame">
          {v.thumbnail ? <Img src={v.thumbnail} alt="" className="card-img" /> : null}
          <div className="card-art-scrim" />
          {released && label && (
            <span className="episode-runtime t-callout">
              <Play size={13} fill="currentColor" /> {label}
            </span>
          )}
          {watched && (
            <span className="episode-watched" aria-label="Watched">
              <Check size={12} strokeWidth={3} />
            </span>
          )}
          {inProgress && <ProgressBar fraction={fraction} />}
        </div>
        <div className="episode-card-text">
          <span className="t-micro episode-kicker">
            {upNext && released ? `Up Next · Episode ${v.episode}` : `Episode ${v.episode}`}
          </span>
          <span className="t-headline episode-card-title">{v.title}</span>
          {v.overview && <p className="t-callout episode-card-overview">{v.overview}</p>}
          <span className="t-caption faint tabular">
            {released ? formatDate(v.released) : `Coming ${formatDate(v.released)}`}
            {v.rating && <span className="episode-rating">★ {v.rating}</span>}
          </span>
        </div>
      </button>
      {released && (
        <button
          className="episode-sources btn btn-glass btn-icon pressable"
          onClick={() => onSources(v)}
          aria-label={`Sources for episode ${v.episode}`}
          title="Choose source"
        >
          <ListVideo size={17} />
        </button>
      )}
    </div>
  );
}
