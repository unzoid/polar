import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { CardRating } from "../components/ImdbBadge";
import { Img } from "../components/Img";
import { LogoOrName, ProgressBar, useCardArt } from "../components/title/Card";
import { useEntryShown, type EntryAt } from "../lib/anime";
import { episodeCode, formatRemaining } from "../lib/format";
import { prefetchMeta, preloadImage, useCatalog, useContinueWatching, useRecommend } from "../lib/net";
import { useRouter } from "../lib/router";
import { useArtGate, useCardIntent } from "../lib/ui";
import type { Shape, Shelf } from "../lib/catalog";
import type { MetaPreview, Progress } from "../lib/types";
import { StageProvider, TvStage, useStage, useStageSeed } from "./TvStage";
import { isMenuKey, openCardMenu } from "./TvCardMenu";
import { refocusNear } from "./spatial";
import { Skeleton } from "../components/ui/Skeleton";

/** Resting on a card this long means interest: fetch its page ahead. Longer than desktop — a held D-pad passes every card. */
const INTENT_MS = 450;

/**
 * A title on a rail. Focus is the selection, as on any TV: the card lifts,
 * the stage above shows the title, and Enter / A opens it.
 */
export function TvCard({
  item: stored,
  shape,
  artFallbacks,
  progress,
  kicker,
  chip,
  entry,
  watching,
  onOpen,
  localOnly,
  onFocusChange,
  staged,
}: {
  item: MetaPreview;
  shape: Shape;
  /** Pictures to try in turn when the card's own won't load. */
  artFallbacks?: string[];
  progress?: number;
  kicker?: string;
  /** Short label shown on the card itself, e.g. "S2, E4 · 23m left". */
  chip?: string;
  /** The watch progress this card stands for, if it's one video (Continue Watching). */
  entry?: Progress;
  /** The episode being watched (`entry`'s by default): with seasons as separate shows, an anime shows its entry (#22). */
  watching?: string;
  onOpen?: () => void;
  /** Not (yet) one of the app's titles, as with anime from AniList: no page to fetch ahead, no options menu. */
  localOnly?: boolean;
  onFocusChange?: (focused: boolean) => void;
  /** What the stage shows for this card where it isn't the card's own art (the Anime tab's featured row, #325). */
  staged?: MetaPreview;
}) {
  const { navigate } = useRouter();
  const { item, entry: shownEntry } = useEntryShown(stored, watching ?? entry?.videoId);
  const onStage = staged ?? item;
  const stage = useStage();
  const seedStage = useStageSeed();
  const el = useRef<HTMLButtonElement>(null);
  const intent = useCardIntent(() => {
    if (!localOnly) prefetchMeta(item.type, item.id);
    preloadImage(item.background);
  }, INTENT_MS);
  // Show on the stage until something is focused, if this is the page's first title.
  useEffect(() => {
    if (el.current) seedStage({ item: onStage, kicker }, el.current);
    // Again once a placeholder title (a playlist entry still loading) fills in, or better art arrives.
  }, [item.id, onStage.name, onStage.background, onStage.logo]);
  // Art that won't load falls back to the title, not an empty frame; better art arriving gets a fresh try.
  const preferred = shape === "poster" ? (item.poster ?? item.background) : (item.background ?? item.poster);
  const { shown: art, onError: onArtError } = useCardArt(preferred);
  // The logo and name wait for the art (#173).
  const gate = useArtGate(art, artFallbacks);
  // An anime shown by its entry opens that entry (TvAnimeDetail takes it on to the title's page with just its episodes).
  const open = onOpen ?? (() => navigate(shownEntry ? { name: "anime-detail", id: shownEntry.anilist } : { name: "detail", type: item.type, id: item.id, preview: item }));

  return (
    <button
      ref={el}
      className="tv-card"
      data-shape={shape}
      aria-label={item.name}
      onClick={open}
      onFocus={() => {
        stage({ item: onStage, kicker });
        onFocusChange?.(true);
        intent.onFocus();
      }}
      onBlur={() => {
        intent.onBlur();
        onFocusChange?.(false);
      }}
      // Options: X / Square on a controller (sent as the Menu key), the Menu key, or a right-click.
      onKeyDown={(e) => {
        if (localOnly || !isMenuKey(e)) return;
        e.preventDefault();
        openCardMenu({ item: stored, entry, anchor: e.currentTarget });
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (localOnly) return;
        e.currentTarget.focus({ preventScroll: true });
        openCardMenu({ item: stored, entry, anchor: e.currentTarget });
      }}
    >
      <span className="tv-card-frame" {...gate}>
        {art ? (
          <Img src={art} fallbacks={artFallbacks} alt="" className="tv-card-img" onFail={onArtError} />
        ) : (
          <span className="tv-card-fallback">{item.name}</span>
        )}
        {shape === "landscape" && art && (
          <>
            <span className="tv-card-scrim art-after" />
            <LogoOrName logo={item.logo} alt="" logoClass="tv-card-logo" name={<span className="tv-card-name art-after">{item.name}</span>} />
          </>
        )}
        {chip && <span className="tv-card-chip">{chip}</span>}
        {progress != null && <ProgressBar fraction={progress} />}
        {shape === "poster" && <CardRating rating={item.imdbRating} placement="poster" />}
      </span>
      {shape === "poster" && <CardRating rating={item.imdbRating} />}
    </button>
  );
}

/** One horizontal shelf. Its focused card stays pinned to the left edge as it scrolls. */
export function TvRail({ title, note, children }: { title?: string; note?: string; children: ReactNode }) {
  return (
    <section className="tv-rail" data-nav-row data-nav-memory>
      {title && (
        <h2 className="tv-rail-title">
          {title}
          {note && <span className="tv-rail-note"> · {note}</span>}
        </h2>
      )}
      <div className="tv-rail-track" data-nav-rail>
        {children}
      </div>
    </section>
  );
}

/**
 * A shelf still loading. Its first card can take focus, so moving down stops here instead of
 * jumping over it (test report 1, item 20); when the cards arrive, focus moves onto them.
 */
export function TvSkeletonRail({ title, shape, count = 8, note }: { title?: string; shape: Shape; count?: number; note?: string }) {
  const first = useRef<HTMLSpanElement>(null);
  useLayoutEffect(
    () => () => {
      const el = first.current;
      if (el && document.activeElement === el) refocusNear(el.getBoundingClientRect());
    },
    [],
  );
  return (
    <TvRail title={title} note={note}>
      {Array.from({ length: count }, (_, i) =>
        i === 0 ? (
          <span key={i} ref={first} className="tv-card tv-card-skeleton" data-shape={shape} tabIndex={0} role="img" aria-label="Loading" data-nav-loading>
            <Skeleton as="span" className="tv-card-frame" />
          </span>
        ) : (
          <span key={i} className="tv-card tv-card-skeleton" data-shape={shape} aria-hidden>
            <Skeleton as="span" className="tv-card-frame" />
          </span>
        ),
      )}
    </TvRail>
  );
}

/** `watching`: title id → the episode last watched, for saved anime shown by their entry (#22). */
export function TvItemsRail({ title, items, shape, watching }: { title: string; items?: MetaPreview[]; shape: Shape; watching?: ReadonlyMap<string, string> }) {
  if (!items) return <TvSkeletonRail title={title} shape={shape} />;
  if (!items.length) return null;
  return (
    <TvRail title={title}>
      {items.map((item) => (
        <TvCard key={item.id} item={item} shape={shape} watching={watching?.get(item.id)} />
      ))}
    </TvRail>
  );
}

/** With fewer fresh titles than this, a shelf shows its full list, repeats and all. */
const MIN_FRESH = 6;

/** A day's shelf (lib/catalog/shelves.ts), fetched once it's close to the focused row. */
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
  if (!data?.length) return null;
  return (
    <TvRail title="Continue Watching">
      {data.map((p) => (
        <TvContinueCard key={p.videoId} p={p} />
      ))}
    </TvRail>
  );
}

/** With seasons as separate shows, an anime's episode goes by its number in its entry (#22). */
function TvContinueCard({ p }: { p: Progress }) {
  const { navigate } = useRouter();
  const stored = useMemo(() => continueItem(p), [p]);
  const { entry } = useEntryShown(stored, p.videoId);
  return (
    <TvCard
      item={stored}
      shape="landscape"
      progress={p.duration ? p.position / p.duration : 0}
      kicker={continueKicker(p, entry)}
      chip={continueChip(p, entry)}
      entry={p}
      onOpen={() => navigate({ name: "player", type: p.type, metaId: p.metaId, videoId: p.videoId, stream: p.stream })}
    />
  );
}

const continueItem = (p: Progress): MetaPreview => ({
  id: p.metaId,
  type: p.type,
  name: p.name,
  background: p.background,
  poster: p.poster,
});

const episodeOf = (p: Progress, entry?: EntryAt) => (entry ? `Episode ${entry.number}` : p.season != null ? episodeCode(p.season, p.episode) : null);

/** The short form for the card itself: episode code (shows only) and time left. */
function continueChip(p: Progress, entry?: EntryAt) {
  return [episodeOf(p, entry), formatRemaining(p.position, p.duration)].filter(Boolean).join(" · ");
}

function continueKicker(p: Progress, entry?: EntryAt) {
  const episode = episodeOf(p, entry);
  const where = episode ? `${episode}${p.episodeTitle ? ` · ${p.episodeTitle}` : ""}` : null;
  return [where, formatRemaining(p.position, p.duration)].filter(Boolean).join(" · ");
}

/** Rows ahead of the focused one that load in advance, so moving down never waits. */
const LOOKAHEAD = 3;

export interface RailRow {
  key: string;
  render: (near: boolean) => ReactNode;
}

/**
 * One row of a browse screen. Moving to another row re-renders only the rows whose `near` changes,
 * not every shelf and card on the page each step of a held direction (#36).
 */
const BrowseRow = memo(function BrowseRow({ row, near }: { row: RailRow; near: boolean }) {
  return row.render(near);
});

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
              <BrowseRow row={r} near={i <= focusRow + LOOKAHEAD} />
            </div>
          ))}
        </div>
      </StageProvider>
    </div>
  );
}
