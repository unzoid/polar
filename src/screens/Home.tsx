import { useQuery } from "@tanstack/react-query";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { prefetchTitlePage, useEntryShown } from "../lib/anime";
import { AmbientWash } from "../components/AmbientWash";
import { ChevronLeft, ChevronRight, Play } from "../components/icons";
import { Img } from "../components/Img";
import { TitleHeading } from "../components/title/TitleHeading";
import { LandscapeCard, PosterCard, useIntent } from "../components/PosterCard";
import { ArtTitle, Card, ProgressBar } from "../components/title/Card";
import { Shelf } from "../components/title/Shelf";
import { Row } from "../components/Row";
import { api } from "../lib/api";
import { episodeCode, formatRemaining, joinFacts, kindFacts } from "../lib/format";
import {
  keys,
  preloadImage,
  useCatalog,
  useContinueWatching,
  useRecommend,
  useSettings,
} from "../lib/net";
import { prefersReducedMotion, useArtGate, useFormFactor, useNearViewport } from "../lib/ui";
import { useRouter } from "../lib/router";
import {
  catalogKey,
  catalogTitle,
  progressItem,
  shelfKey,
  shelfRoute,
  todaysShelves,
  useAddonCatalogRow,
  useFeatured,
  useHomeCatalogs,
  useSeeds,
  useShownAbove,
  type AddonCatalog,
  type Shelf as HomeShelf,
} from "../lib/catalog";
import { cardMenu } from "../components/CardMenu";
import type { MetaPreview, Progress } from "../lib/types";
import { Button, IconButton } from "../components/ui/Button";
import { LibraryButton } from "../components/title/LibraryButton";
import { Skeleton } from "../components/ui/Skeleton";

/**
 * The page, top to bottom: featured carousel, what you're watching, then the
 * the add-on catalogs switched on in Settings → Add-ons (#206), then the
 * day's shelves (lib/catalog/shelves.ts). A title already shown higher up (the
 * carousel included) is left out of the shelves below it. Shelves below the
 * fold only fetch when scrolled near.
 */

const NO_TITLES: MetaPreview[] = [];

/** The first shelves load immediately; the rest wait until they're close. */
const EAGER_SHELVES = 2;

export function Home() {
  const { data: items } = useFeatured();
  const [index, setIndex] = useState(0);
  const seeds = useSeeds();
  const shelves = useMemo(() => todaysShelves(seeds), [seeds]);
  const shownAbove = useShownAbove(shelves, items ?? NO_TITLES);
  const { data: watching } = useContinueWatching();
  const watched = useMemo(() => new Set((watching ?? []).map((p) => p.metaId)), [watching]);
  const { data: settings } = useSettings();
  const addonRows = useHomeCatalogs();

  return (
    <div className="scroll home">
      <HeroCarousel items={items} index={index} setIndex={setIndex} />
      <div className="rows home-rows">
        {(settings?.showContinueWatching ?? true) && <ContinueRow />}
        {addonRows.map((c) => (
          <AddonShelf key={catalogKey(c)} catalog={c} />
        ))}
        {shelves.map((shelf, i) => (
          <LazyShelf
            key={shelfKey(shelf).join("/")}
            shelf={shelf}
            eager={i < EAGER_SHELVES}
            // Recommendations also skip what you're already watching.
            exclude={shelf.kind === "because" ? new Set([...shownAbove[i], ...watched]) : shownAbove[i]}
          />
        ))}
      </div>
    </div>
  );
}

// --- Hero ----------------------------------------------------------------

const ADVANCE_MS = 9000;

/**
 * Featured carousel: a framed card, with the page behind it tinted by the art. Auto-advances, but never while you're
 * pointing at it, while the window is in the background, or when the OS asks
 * for reduced motion. The art cross-fades rather than slides: a full-screen
 * slide is a vestibular trigger and an abrupt cut is a brightness jump.
 */
export function HeroCarousel({
  items,
  index,
  setIndex,
  content,
  handlers,
}: {
  items?: MetaPreview[];
  index: number;
  setIndex: (i: number | ((i: number) => number)) => void;
  /** The text block over the art, for a page whose titles open somewhere else (Anime). */
  content?: (item: MetaPreview) => ReactNode;
  /** What clicking and right-clicking the art does; by default the title's page and its options menu. */
  handlers?: (item: MetaPreview) => { onClick: () => void; onContextMenu: (e: React.MouseEvent<HTMLElement>) => void };
}) {
  const { navigate } = useRouter();
  const [paused, setPaused] = useState(false);
  const hero = useRef<HTMLDivElement>(null);
  const count = items?.length ?? 0;
  const item = items?.[index];
  // The logo or name waits for the current backdrop (#173).
  const gate = useArtGate(item?.background);
  const gateRef = gate.ref;
  const heroRef = useCallback(
    (node: HTMLDivElement | null) => {
      hero.current = node;
      gateRef(node);
    },
    [gateRef],
  );

  const { data: settings } = useSettings();
  const rotate = settings?.heroAutoplay ?? true;
  useEffect(() => {
    if (!count || paused || !rotate) return;
    if (prefersReducedMotion()) return;
    const t = window.setInterval(() => {
      // Don't rotate while hidden under another page or behind other windows.
      if (document.hasFocus() && hero.current?.checkVisibility({ visibilityProperty: true })) {
        setIndex((i) => (i + 1) % count);
      }
    }, ADVANCE_MS);
    return () => window.clearInterval(t);
  }, [index, count, paused, rotate, setIndex]);

  // Decode the next backdrop ahead of time so the cross-fade never waits.
  useEffect(() => {
    if (items && count) preloadImage(items[(index + 1) % count].background);
  }, [items, index, count]);

  // A sideways swipe on touch steps through the titles, as the arrows do.
  const swiped = useRef(false);
  const swipeHandlers = useHeroSwipe(count > 1, (dir) => setIndex((index + dir + count) % count), swiped);

  if (!items || !item) {
    return (
      <section className="hero">
        <Skeleton className="hero-card hero-placeholder" />
      </section>
    );
  }

  const h = handlers?.(item) ?? {
    onClick: () => navigate({ name: "detail", type: item.type, id: item.id, preview: item }),
    onContextMenu: cardMenu(item).onContextMenu,
  };

  return (
    <section className="hero" aria-roledescription="carousel">
      {/* The page around the card takes on the art's colours: a heavily
          blurred copy of each backdrop, cross-fading with it. */}
      <div className="hero-ambient" aria-hidden>
        {items.map((it, i) => (
          <AmbientWash key={it.id} src={it.background} current={i === index} />
        ))}
      </div>
      <div className="hero-stage">
      {count > 1 && <HeroPeek item={items[(index - 1 + count) % count]} side="prev" onClick={() => setIndex((index - 1 + count) % count)} />}
      <div
        className="hero-card"
        ref={heroRef}
        data-art={gate["data-art"]}
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
        {...swipeHandlers}
        // The whole card opens the title, except where its own controls sit (or a swipe just ended on it).
        onClick={(e) => !swiped.current && !(e.target as Element).closest("button, a") && h.onClick()}
        // ← and → step through the featured titles while focus is on the card's controls.
        onKeyDown={(e) => {
          if (count < 2 || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          setIndex((index + (e.key === "ArrowLeft" ? count - 1 : 1)) % count);
        }}
        onContextMenu={h.onContextMenu}
      >
        <div className="hero-art">
          {items.map((it, i) => (
            <Img
              key={it.id}
              src={it.background}
              alt=""
              loading={i === 0 ? "eager" : "lazy"}
              className="hero-backdrop"
              data-current={i === index}
            />
          ))}
        </div>
        <div className="hero-scrim" />

        {/* Keyed: the text block swaps with a short blur-masked fade. */}
        <Fragment key={item.id}>{content ? content(item) : <HeroContent item={item} />}</Fragment>

        <div className="hero-pager">
          <div className="hero-dots" role="tablist" aria-label="Featured">
            {items.map((it, i) => (
              <button
                key={it.id}
                role="tab"
                aria-selected={i === index}
                aria-label={it.name}
                className="hero-dot"
                onClick={() => setIndex(i)}
              >
                {i === index && !paused && (
                  <span key={index} className="hero-dot-clip">
                    <span className="hero-dot-fill" style={{ animationDuration: `${ADVANCE_MS}ms` }} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
        {count > 1 && (
          <div className="hero-steps">
            <IconButton variant="glass" className="hero-next pressable" label="Previous featured" onClick={() => setIndex((index - 1 + count) % count)}>
              <ChevronLeft size={22} />
            </IconButton>
            <IconButton variant="glass" className="hero-next pressable" label="Next featured" onClick={() => setIndex((index + 1) % count)}>
              <ChevronRight size={22} />
            </IconButton>
          </div>
        )}
      </div>
      {count > 1 && <HeroPeek item={items[(index + 1) % count]} side="next" onClick={() => setIndex((index + 1) % count)} />}
      </div>
    </section>
  );
}

/** Below this many pixels sideways a touch is a tap. */
const SWIPE_MIN_PX = 12;
/** Past either, the swipe turns the page: a long drag or a quick flick (px per ms), whichever comes first. */
const SWIPE_DISTANCE_PX = 56;
const SWIPE_VELOCITY = 0.3;

/**
 * Touch swipes on the featured card (mouse and pen keep their click). The card
 * lets the page scroll up and down (`touch-action: pan-y`), so a vertical move
 * cancels the pointer and only sideways ones reach here. `swiped` stays set
 * until the click that follows the lifted finger, so that click doesn't open
 * the title.
 */
function useHeroSwipe(enabled: boolean, step: (dir: 1 | -1) => void, swiped: React.RefObject<boolean>) {
  const start = useRef<{ id: number; x: number; y: number; t: number } | null>(null);
  if (!enabled) return {};
  return {
    onPointerDown: (e: React.PointerEvent) => {
      swiped.current = false;
      if (e.pointerType !== "touch" || !e.isPrimary) return;
      start.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x;
      if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(e.clientY - s.y)) return;
      swiped.current = true;
      const velocity = Math.abs(dx) / Math.max(1, e.timeStamp - s.t);
      if (Math.abs(dx) >= SWIPE_DISTANCE_PX || velocity > SWIPE_VELOCITY) step(dx < 0 ? 1 : -1);
    },
    onPointerCancel: () => {
      start.current = null;
    },
  };
}

/**
 * On a window much wider than the card (ultrawide), the featured titles
 * before and after it, dimmed at its sides, the way a carousel continues.
 * Hidden by CSS everywhere else.
 */
function HeroPeek({ item, side, onClick }: { item: MetaPreview; side: "prev" | "next"; onClick: () => void }) {
  return (
    <button className="hero-peek" data-side={side} onClick={onClick} aria-label={`${side === "prev" ? "Previous" : "Next"} featured: ${item.name}`} tabIndex={-1}>
      <Img key={item.id} src={item.background} alt="" className="hero-peek-img" />
    </button>
  );
}

function HeroContent({ item }: { item: MetaPreview }) {
  const { navigate } = useRouter();
  const intent = useIntent(item);
  const open = () => navigate({ name: "detail", type: item.type, id: item.id, preview: item });
  // A phone's card is Netflix's: Watch Now and Save side by side, each half the width (cards.css).
  const phone = useFormFactor().form === "phone";

  return (
    <div className="hero-content">
      <TitleHeading name={item.name} logo={item.logo} logos={item.logos} backdrop={item.background} look="hero" />
      <p className="hero-kind t-callout">{joinFacts(kindFacts(item))}</p>
      <p className="hero-description t-body">{item.description}</p>
      <div className="hero-actions">
        <Button variant="primary" onClick={open} {...intent}>
          <Play size={18} fill="currentColor" /> Watch Now
        </Button>
        <LibraryButton item={item} labelled={phone} />
      </div>
    </div>
  );
}

// --- Shelves --------------------------------------------------------------

/** With fewer fresh titles than this, a shelf shows its full list, repeats and all. */
const MIN_FRESH = 6;

function CatalogRow({ shelf, enabled, exclude }: { shelf: HomeShelf; enabled: boolean; exclude: Set<string> }) {
  const { title, shape } = shelf;
  const isCatalog = shelf.kind === "catalog";
  const catalog = useCatalog(shelf.type, isCatalog ? shelf.id : "", isCatalog ? shelf.genre : undefined, enabled && isCatalog);
  const recommended = useRecommend(shelf.type, isCatalog ? "" : shelf.seed, enabled && !isCatalog);
  const { data, isLoading, isError } = isCatalog ? catalog : recommended;
  const { navigate } = useRouter();
  const to = shelfRoute(shelf);
  const items = useMemo(() => {
    const fresh = (data ?? []).filter((m) => !exclude.has(m.id));
    return fresh.length >= MIN_FRESH || shelf.kind === "because" ? fresh : (data ?? []);
  }, [data, exclude, shelf.kind]);

  if (isError) return null; // one failing catalog shouldn't break the page
  // Nothing good to recommend: leave the row out rather than show a stub.
  if (shelf.kind === "because" && data && items.length < 4) return null;
  const TitleCard = shape === "landscape" ? LandscapeCard : PosterCard;
  return (
    <Shelf
      title={title}
      onOpen={to && (() => navigate(to))}
      shape={shape}
      items={isLoading || !enabled ? undefined : items}
      card={(item) => <TitleCard key={item.id} item={item} />}
    />
  );
}

/** Holds a shelf back (as a skeleton) until it's near the viewport. */
function LazyShelf({ shelf, eager, exclude }: { shelf: HomeShelf; eager: boolean; exclude: Set<string> }) {
  const [ref, near] = useNearViewport<HTMLDivElement>(eager);
  return (
    <div ref={ref}>
      <CatalogRow shelf={shelf} enabled={near} exclude={exclude} />
    </div>
  );
}

/**
 * An add-on's catalog as a row (#206): fetched once near, left out when the add-on fails, is
 * too slow or has nothing. Its titles aren't deduplicated against the shelves: it's the user's list.
 */
function AddonShelf({ catalog }: { catalog: AddonCatalog }) {
  const [ref, near] = useNearViewport<HTMLDivElement>();
  const { data, isError } = useAddonCatalogRow(catalog, near);
  const { navigate } = useRouter();
  return (
    <div ref={ref} data-addon-row={catalog.id}>
      {!isError && !(data && !data.length) && (
        <Shelf
          title={catalogTitle(catalog)}
          onOpen={() => navigate({ name: "discover", type: catalog.type, catalog: catalog.id, addon: catalog.addon })}
          items={data}
          card={(item) => <PosterCard key={item.id} item={item} />}
        />
      )}
    </div>
  );
}

function ContinueRow() {
  const { data } = useContinueWatching();
  const items = useMemo(() => data ?? [], [data]);
  const order = useMemo(() => items.map((p) => p.videoId).join(" "), [items]);
  if (!items.length) return null;
  return (
    <Row title="Continue Watching" shape="landscape" order={order}>
      {items.map((p) => (
        <ContinueCard key={p.videoId} progress={p} />
      ))}
    </Row>
  );
}

/**
 * The card opens the title's page; the play button resumes straight away. With seasons as separate shows,
 * an anime shows the entry the episode is part of and opens its page (#22).
 */
function ContinueCard({ progress: p }: { progress: Progress }) {
  const { navigate } = useRouter();
  const stored = useMemo(() => progressItem(p), [p]);
  const { item, entry, opens } = useEntryShown(stored, p.videoId);
  const openDetail = () => navigate({ name: "detail", type: p.type, id: opens });
  // Which page it opens on is known before the click (mostly a stored anime link: no network).
  useEffect(() => prefetchTitlePage(p.type, opens), [p.type, opens]);
  const resume = () => navigate({ name: "player", type: p.type, metaId: p.metaId, videoId: p.videoId, stream: p.stream });
  const fraction = p.duration ? p.position / p.duration : 0;
  const meta = useQuery({ queryKey: keys.meta(p.type, p.metaId), queryFn: () => api.meta(p.type, p.metaId), staleTime: 60 * 60_000 });
  const logo = meta.data?.logo;

  return (
    <Card
      shape="landscape"
      frameClass="card-frame-resume"
      art={p.background ?? p.poster}
      title={
        entry
          ? `Episode ${entry.number} · ${p.episodeTitle ?? item.name}`
          : p.season != null
            ? `${episodeCode(p.season, p.episode)} · ${p.episodeTitle ?? p.name}`
            : p.name
      }
      // Always shown: it's what you're watching, not a description.
      keepCaption
      onClick={openDetail}
      {...cardMenu(stored, p)}
      actions={
        <button
          type="button"
          className="card-play"
          aria-label="Resume"
          onClick={(e) => {
            e.stopPropagation();
            resume();
          }}
        >
          <Play size={20} fill="currentColor" />
        </button>
      }
    >
      {/* The logo names the show; an entry of it goes by its own name. */}
      <ArtTitle name={item.name} logo={entry ? undefined : logo} />
      {/* Where you are, on the picture like Apple TV's: a short bar and the time left, over a progressive blur. */}
      <div className="card-resume">
        <ProgressBar fraction={fraction} />
        <span className="card-resume-left tabular">{formatRemaining(p.position, p.duration)}</span>
      </div>
    </Card>
  );
}
