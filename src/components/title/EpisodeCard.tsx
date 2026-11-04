import { useCardIntent } from "../../lib/cardIntent";
import { episodeState } from "../../lib/episodeState";
import { formatDate, formatRemaining, shortRuntime } from "../../lib/format";
import { prefetchStreams } from "../../lib/queries";
import type { EpisodeLayout, MetaPreview, Progress, Video } from "../../lib/types";
import { watchedFraction } from "../../lib/watched";
import { DownloadButton } from "../DownloadButton";
import { Check, Play, Sources } from "../icons";
import { StillPlaceholder } from "../StillPlaceholder";
import { IconButton, buttonClass } from "../ui/Button";
import { CardArt, ProgressBar } from "./Card";

/**
 * One episode of a season (docs/ui-components.md U8): the still with its runtime or time left, watched mark,
 * progress and filler tag, then the kicker, title, synopsis and airdate; the sources and download buttons
 * float on it. `layout="list"` adds the number column. Used by `EpisodeShelf`; TV draws its own row (step 6).
 */
export function EpisodeCard({
  layout,
  video: v,
  progress: p,
  runtime,
  upNext,
  onPlay,
  onSources,
  menu,
  item,
}: {
  item?: MetaPreview;
  layout: EpisodeLayout;
  video: Video;
  progress?: Progress;
  runtime?: string;
  upNext: boolean;
  onPlay: (v: Video) => void;
  onSources: (v: Video) => void;
  menu?: { onContextMenu: (e: React.MouseEvent<HTMLElement>) => void };
}) {
  const { released, fraction, watched, inProgress } = episodeState(v, p, watchedFraction());
  // Resting on an episode is intent to watch it — warm its sources.
  const intent = useCardIntent(() => released && prefetchStreams("series", v.id), 150);

  const label = inProgress && p ? formatRemaining(p.position, p.duration) : shortRuntime(runtime);

  return (
    <div
      className="episode-card"
      data-layout={layout}
      data-video={v.id}
      data-up-next={upNext}
      data-unreleased={!released}
      // Settings → Browsing can hide stills and synopses of these (spoilers).
      data-unwatched={!watched}
      {...menu}
    >
      <button className="card card-landscape episode-card-main" disabled={!released} onClick={() => onPlay(v)} {...intent}>
        <div className="card-frame">
          <CardArt src={v.thumbnail} fallback={<StillPlaceholder />} />
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
          {/* Filler / Recap: on the art, so it's the first thing you see when deciding to skip. */}
          {v.tag && <span className="episode-tag t-micro">{v.tag}</span>}
        </div>
        {layout === "list" && <span className="episode-number tabular">{v.episode}</span>}
        <div className="episode-card-text">
          {layout === "list" ? (
            // The number column already says which episode it is.
            upNext && released ? <span className="t-micro episode-kicker">Up Next</span> : null
          ) : (
            <span className="t-micro episode-kicker">
              {upNext && released ? `Up Next · Episode ${v.episode}` : `Episode ${v.episode}`}
            </span>
          )}
          <span className="t-headline episode-card-title">{v.title}</span>
          {v.overview && <p className="t-callout episode-card-overview">{v.overview}</p>}
          <span className="t-caption faint tabular">
            {released ? formatDate(v.released) : `Coming ${formatDate(v.released)}`}
            {Number(v.rating) > 0 && <span className="episode-rating">★ {v.rating}</span>}
          </span>
        </div>
      </button>
      {released && (
        <IconButton
          variant="glass"
          className="episode-sources pressable"
          onClick={() => onSources(v)}
          label={`Sources for episode ${v.episode}`}
          title="Choose source"
        >
          <Sources size={17} />
        </IconButton>
      )}
      {released && item && <DownloadButton item={item} video={v} className={buttonClass("glass", true, "episode-download pressable")} size={18} />}
    </div>
  );
}
