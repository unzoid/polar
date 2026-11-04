import { useLayoutEffect, useRef } from "react";
import type { EpisodeLayout, MetaPreview, Progress, Video } from "../../lib/types";
import { Row } from "../Row";
import { EpisodeCard } from "./EpisodeCard";

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
