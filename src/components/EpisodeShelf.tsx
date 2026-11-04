import { Check, Play, Sources } from "./icons";
import { useLayoutEffect, useRef, useState } from "react";
import { formatDate, formatRemaining, isReleased } from "../lib/format";
import { prefetchStreams } from "../lib/queries";
import type { EpisodeLayout, MetaPreview, Progress, Video } from "../lib/types";
import { DownloadButton } from "./DownloadButton";
import { watchedFraction } from "../lib/watched";
import { Img } from "./Img";
import { StillPlaceholder } from "./StillPlaceholder";
import { ProgressBar } from "./title/Card";
import { Row } from "./Row";
import { IconButton, buttonClass } from "./ui/Button";

/**
 * A season as a horizontal shelf of episode lockups (tvOS): still with a
 * "▶ 42m" label, then EPISODE N, title, a three-line synopsis and the airdate.
 * Opens scrolled to the episode you're up to.
 *
 * As a "list", the same episodes stack vertically: number, still, then the
 * title, runtime and synopsis beside it.
 */
export function EpisodeShelf({
  layout = "row",
  episodes,
  progress,
  runtime,
  upNextId,
  onPlay,
  onSources,
  menu,
  item,
}: {
  /** The show: given, each released episode gets a download control. */
  item?: MetaPreview;
  layout?: EpisodeLayout;
  episodes: Video[];
  progress: Map<string, Progress>;
  runtime?: string;
  upNextId?: string;
  onPlay: (v: Video) => void;
  onSources: (v: Video) => void;
  /** Right-click options for an episode. */
  menu?: (v: Video) => { onContextMenu: (e: React.MouseEvent<HTMLElement>) => void };
}) {
  const shelf = useRef<HTMLDivElement>(null);

  // Jump (no animation) so "up next" is the first card in view.
  useLayoutEffect(() => {
    const scroller = shelf.current?.querySelector<HTMLElement>(".row-scroller");
    if (!scroller) return;
    const el = upNextId ? scroller.querySelector<HTMLElement>(`[data-video="${CSS.escape(upNextId)}"]`) : null;
    const pad = parseFloat(getComputedStyle(scroller).paddingLeft);
    scroller.scrollLeft = el ? el.offsetLeft - pad : 0;
  }, [episodes, upNextId, layout]);

  const cards = episodes.map((v) => (
    <EpisodeCard
      key={v.id}
      layout={layout}
      video={v}
      progress={progress.get(v.id)}
      runtime={runtime}
      upNext={v.id === upNextId}
      onPlay={onPlay}
      onSources={onSources}
      menu={menu?.(v)}
      item={item}
    />
  ));

  if (layout === "list") return <div className="episode-list">{cards}</div>;
  return (
    <div ref={shelf}>
      <Row shape="episode">{cards}</Row>
    </div>
  );
}

/** A card still that falls back to the placeholder when missing or broken. */
function ShelfStill({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <StillPlaceholder />;
  return <Img src={src} alt="" className="card-img" onError={() => setFailed(true)} />;
}

/** "49 min" → "49m" */
const shortRuntime = (r?: string) => r?.replace(/\s*min$/, "m");

function EpisodeCard({
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
  const released = isReleased(v);
  const fraction = p?.duration ? p.position / p.duration : 0;
  const watched = fraction >= watchedFraction();
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
          <ShelfStill src={v.thumbnail} />
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
