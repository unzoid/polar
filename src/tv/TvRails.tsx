import { useEffect, useMemo, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { CardRating } from "../components/ImdbBadge";
import { Img } from "../components/Img";
import { ProgressBar } from "../components/PosterCard";
import { episodeCode, formatRemaining } from "../lib/format";
import { prefetchMeta, preloadImage, useCatalog, useContinueWatching, useRecommend } from "../lib/queries";
import { useRouter } from "../lib/router";
import type { Shape, Shelf } from "../lib/shelves";
import type { MetaPreview, Progress } from "../lib/types";
import { StageProvider, TvStage, useStage, useStageSeed } from "./TvStage";

/** Resting on a card this long means interest: fetch its page ahead. Longer than desktop — a held D-pad passes every card. */
const INTENT_MS = 450;

/**
 * A title on a rail. Focus is the selection, as on any TV: the card lifts,
 * the stage above shows the title, and Enter / A opens it.
 */
export function TvCard({
  item,
  shape,
  progress,
  kicker,
  chip,
  onOpen,
}: {
  item: MetaPreview;
  shape: Shape;
  progress?: number;
  kicker?: string;
  /** Short label shown on the card itself, e.g. "S2, E4 · 23m left". */
  chip?: string;
  onOpen?: () => void;
}) {
  const { navigate } = useRouter();
  const stage = useStage();
  const seedStage = useStageSeed();
  const el = useRef<HTMLButtonElement>(null);
  const timer = useRef<number>(undefined);
  // Show on the stage until something is focused, if this is the page's first title.
  useEffect(() => {
    if (el.current) seedStage({ item, kicker }, el.current);
    // Again once a placeholder title (a playlist entry still loading) fills in.
  }, [item.id, item.name]);
  // Art that won't load falls back to the title, not an empty frame.
  const [broken, setBroken] = useState(false);
  const preferred = shape === "poster" ? (item.poster ?? item.background) : (item.background ?? item.poster);
  const art = broken ? undefined : preferred;
  const open = onOpen ?? (() => navigate({ name: "detail", type: item.type, id: item.id, preview: item }));

  return (
    <button
      ref={el}
      className="tv-card"
      data-shape={shape}
      aria-label={item.name}
      onClick={open}
      onFocus={() => {
        stage({ item, kicker });
        timer.current = window.setTimeout(() => {
          prefetchMeta(item.type, item.id);
          preloadImage(item.background);
        }, INTENT_MS);
      }}
      onBlur={() => window.clearTimeout(timer.current)}
    >
      <span className="tv-card-frame">
        {art ? (
          <Img src={art} alt="" className="tv-card-img" onError={() => setBroken(true)} />
        ) : (
          <span className="tv-card-fallback">{item.name}</span>
        )}
        {shape === "landscape" && art && (
          <>
            <span className="tv-card-scrim" />
            {item.logo ? <Img src={item.logo} alt="" className="tv-card-logo" /> : <span className="tv-card-name">{item.name}</span>}
          </>
        )}
        {chip && <span className="tv-card-chip">{chip}</span>}
        {progress != null && <ProgressBar fraction={progress} />}
      </span>
      {shape === "poster" && <CardRating rating={item.imdbRating} />}
    </button>
  );
}

/** One horizontal shelf. Its focused card stays pinned to the left edge as it scrolls. */
export function TvRail({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="tv-rail" data-nav-row data-nav-memory>
      {title && <h2 className="tv-rail-title">{title}</h2>}
      <div className="tv-rail-track" data-nav-rail>
        {children}
      </div>
    </section>
  );
}

export function TvSkeletonRail({ title, shape, count = 8 }: { title?: string; shape: Shape; count?: number }) {
  return (
    <TvRail title={title}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="tv-card tv-card-skeleton" data-shape={shape} aria-hidden>
          <span className="tv-card-frame skeleton" />
        </span>
      ))}
    </TvRail>
  );
}

export function TvItemsRail({ title, items, shape }: { title: string; items?: MetaPreview[]; shape: Shape }) {
  if (!items) return <TvSkeletonRail title={title} shape={shape} />;
  if (!items.length) return null;
  return (
    <TvRail title={title}>
      {items.map((item) => (
        <TvCard key={item.id} item={item} shape={shape} />
      ))}
    </TvRail>
  );
}

/** With fewer fresh titles than this, a shelf shows its full list, repeats and all. */
const MIN_FRESH = 6;

/** A day's shelf (lib/shelves.ts), fetched once it's close to the focused row. */
export function TvShelfRail({ shelf, enabled, exclude }: { shelf: Shelf; enabled: boolean; exclude: Set<string> }) {
  const isCatalog = shelf.kind === "catalog";
  const catalog = useCatalog(shelf.type, isCatalog ? shelf.id : "", isCatalog ? shelf.genre : undefined, enabled && isCatalog);
  const recommended = useRecommend(shelf.type, isCatalog ? "" : shelf.seed, enabled && !isCatalog);
  const { data, isError } = isCatalog ? catalog : recommended;
  const items = useMemo(() => {
    if (!data) return undefined;
    const fresh = data.filter((m) => !exclude.has(m.id));
    return fresh.length >= MIN_FRESH || shelf.kind === "because" ? fresh : data;
  }, [data, exclude, shelf.kind]);

  if (isError) return null;
  if (shelf.kind === "because" && items && items.length < 4) return null;
  return <TvItemsRail title={shelf.title} items={items} shape={shelf.shape} />;
}

/** Pick up where you left off: straight into the player, no detour. */
export function TvContinueRail() {
  const { data } = useContinueWatching();
  const { navigate } = useRouter();
  if (!data?.length) return null;
  return (
    <TvRail title="Continue Watching">
      {data.map((p) => (
        <TvCard
          key={p.videoId}
          item={continueItem(p)}
          shape="landscape"
          progress={p.duration ? p.position / p.duration : 0}
          kicker={continueKicker(p)}
          chip={continueChip(p)}
          onOpen={() => navigate({ name: "player", type: p.type, metaId: p.metaId, videoId: p.videoId, stream: p.stream })}
        />
      ))}
    </TvRail>
  );
}

const continueItem = (p: Progress): MetaPreview => ({
  id: p.metaId,
  type: p.type,
  name: p.name,
  background: p.background,
  poster: p.poster,
});

/** The short form for the card itself: episode code (shows only) and time left. */
function continueChip(p: Progress) {
  return [p.season != null ? episodeCode(p.season, p.episode) : null, formatRemaining(p.position, p.duration)]
    .filter(Boolean)
    .join(" · ");
}

function continueKicker(p: Progress) {
  const where = p.season != null ? `${episodeCode(p.season, p.episode)}${p.episodeTitle ? ` · ${p.episodeTitle}` : ""}` : null;
  return [where, formatRemaining(p.position, p.duration)].filter(Boolean).join(" · ");
}

/** Rows ahead of the focused one that load in advance, so moving down never waits. */
const LOOKAHEAD = 3;

export interface RailRow {
  key: string;
  render: (near: boolean) => ReactNode;
}

/**
 * A browse screen: the stage on top, rails below. The focused rail always
 * sits at the same height just under the stage — moving down slides the
 * rails up rather than moving your eye down the screen.
 */
export function TvBrowse({ rows }: { rows: RailRow[] }) {
  const [focusRow, setFocusRow] = useState(0);
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-row]");
    if (row) setFocusRow(Number(row.dataset.row));
  };
  return (
    <div className="tv-browse">
      <StageProvider render={(entry) => <TvStage entry={entry} />}>
        <div className="tv-rails" data-nav-scroll="start" onFocus={onFocus}>
          {rows.map((r, i) => (
            <div key={r.key} data-row={i}>
              {r.render(i <= focusRow + LOOKAHEAD)}
            </div>
          ))}
        </div>
      </StageProvider>
    </div>
  );
}
