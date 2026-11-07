import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { episodeState, watchedFraction } from "../../lib/library";
import { formatDate, formatRemaining, shortRuntime } from "../../lib/format";
import type { Meta, Progress, Video } from "../../lib/types";
import { DownloadButton } from "../DownloadButton";
import { buttonClass } from "../ui/Button";
import { Check, Play } from "../icons";
import { RowPaddle } from "../Row";
import { Img } from "../Img";
import { StillPlaceholder } from "../StillPlaceholder";
import { prefersReducedMotion } from "../../lib/ui";

/**
 * The player's Episodes, as a streaming app lays them out: a season's episodes side by side, each
 * a still with its number and title, Download, its length and synopsis. The one playing is marked
 * and scrolled into view; picking another plays it (the season is chosen above, in the column's head).
 *
 * Every episode can be reached (#226): trackpads and fingers scroll it natively, a mouse wheel's
 * up/down turns into left/right, Home's shelf paddles (RowPaddle, #250) at the ends page it on
 * desktop, and the arrow keys move card by card (OptionsOverlay's moveFocus), the focused card
 * scrolled into view.
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
  const [edges, setEdges] = useState<Edges>({ start: true, end: true });

  // Open on the episode that's playing (or the season's start), without animating the jump. Only
  // when the season or the episode changes: the player re-renders several times a second, and
  // jumping back on each would undo every scroll (#226).
  const season = episodes[0]?.id;
  useLayoutEffect(() => {
    const el = rail.current;
    const card = el?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!el) return;
    // The rail is the cards' offset parent (position: relative).
    el.scrollLeft = card?.offsetLeft ?? 0;
    setEdges((e) => sameEdges(e, edgesOf(el)));
  }, [season, playing]);

  const shown = episodes.length > 0;

  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    const update = () => setEdges((e) => sameEdges(e, edgesOf(el)));
    // A mouse wheel only turns up and down; nothing here scrolls that way, so it moves the rail.
    // A trackpad's sideways swipe (deltaX) and pinch (ctrlKey) stay native.
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 40 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? el.clientWidth : 1;
      e.preventDefault();
      el.scrollLeft += e.deltaY * unit;
    };
    // A card reached by the keys (or Tab) comes into view; the browser's own scroll would also move the panel.
    const focus = (e: FocusEvent) => {
      const card = (e.target as Element).closest<HTMLElement>(".episode-rail-card");
      if (card) reveal(el, card);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("focusin", focus);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("focusin", focus);
      ro.disconnect();
    };
  }, [shown]);

  const page = (dir: 1 | -1) => {
    const el = rail.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };

  if (!episodes.length) return <p className="options-empty">No episodes in this season yet.</p>;

  return (
    <div className="row-viewport episode-rail-viewport" data-start={edges.start} data-end={edges.end}>
      <RowPaddle dir="prev" onPage={page} />
      <RowPaddle dir="next" onPage={page} />
      <div className="episode-rail" ref={rail}>
        {episodes.map((v) => {
          const p = progress.get(v.id);
          const { released, fraction, watched, inProgress } = episodeState(v, p, watchedFraction());
          const current = v.id === playing;
          const length = inProgress && p ? formatRemaining(p.position, p.duration) : shortRuntime(meta.runtime);
          return (
            <article key={v.id} className="episode-rail-card" aria-current={current || undefined} data-unwatched={!watched}>
              {/* The one playing can't be picked again, but takes the focus when the panel opens (a remote starts from it). */}
              <button
                className="episode-rail-main"
                disabled={!released}
                aria-disabled={current || undefined}
                onClick={() => !current && onPlay(v.id)}
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
    </div>
  );
}

type Edges = { start: boolean; end: boolean };
const edgesOf = (el: HTMLElement): Edges => ({ start: el.scrollLeft < 4, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 4 });
/** Same edges, same object: a new one per scroll event would re-render every card each frame. */
const sameEdges = (was: Edges, now: Edges) => (was.start === now.start && was.end === now.end ? was : now);

/** Scrolls `card` fully into `rail`'s view, the least distance (the rail alone, not its ancestors). */
function reveal(rail: HTMLElement, card: HTMLElement) {
  const left = card.offsetLeft;
  const right = left + card.offsetWidth;
  const to = left < rail.scrollLeft ? left : right > rail.scrollLeft + rail.clientWidth ? right - rail.clientWidth : null;
  if (to !== null) rail.scrollTo({ left: to, behavior: prefersReducedMotion() ? "auto" : "smooth" });
}
