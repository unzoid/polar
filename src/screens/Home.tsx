import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { AmbientWash } from "../components/AmbientWash";
import { Check, ChevronRight, Play, Plus } from "../components/icons";
import { Img } from "../components/Img";
import { CardSkeleton, LandscapeCard, PosterCard, ProgressBar, useIntent } from "../components/PosterCard";
import { Row } from "../components/Row";
import { SwapIcon } from "../components/SwapIcon";
import { api } from "../lib/api";
import { episodeCode, formatRemaining } from "../lib/format";
import {
  keys,
  preloadImage,
  useCatalog,
  useContinueWatching,
  useLibrary,
  useRecommend,
  useSettings,
  useToggleLibrary,
} from "../lib/queries";
import { prefersReducedMotion } from "../lib/reducedMotion";
import { useRouter } from "../lib/router";
import { shelfKey, todaysShelves, useFeatured, useSeeds, useShownAbove, type Shelf } from "../lib/shelves";
import type { MetaPreview, Progress } from "../lib/types";

/**
 * The page, top to bottom: featured carousel, what you're watching, then the
 * day's shelves (lib/shelves.ts). A title already shown higher up (the
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

  return (
    <div className="scroll home">
      <HeroCarousel items={items} index={index} setIndex={setIndex} />
      <div className="rows home-rows">
        {(settings?.showContinueWatching ?? true) && <ContinueRow />}
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
function HeroCarousel({
  items,
  index,
  setIndex,
}: {
  items?: MetaPreview[];
  index: number;
  setIndex: (i: number | ((i: number) => number)) => void;
}) {
  const [paused, setPaused] = useState(false);
  const hero = useRef<HTMLDivElement>(null);
  const count = items?.length ?? 0;
  const item = items?.[index];

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

  if (!items || !item) {
    return (
      <section className="hero">
        <div className="hero-card hero-placeholder skeleton" />
      </section>
    );
  }

  return (
    <section className="hero" aria-roledescription="carousel">
      {/* The page around the card takes on the art's colours: a heavily
          blurred copy of each backdrop, cross-fading with it. */}
      <div className="hero-ambient" aria-hidden>
        {items.map((it, i) => (
          <AmbientWash key={it.id} src={it.background} current={i === index} />
        ))}
      </div>
      <div className="hero-card" ref={hero} onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}>
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
        <HeroContent key={item.id} item={item} />

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
                  <span key={index} className="hero-dot-fill" style={{ animationDuration: `${ADVANCE_MS}ms` }} />
                )}
              </button>
            ))}
          </div>
        </div>
        <button
          className="hero-next btn btn-glass btn-icon pressable"
          aria-label="Next featured"
          onClick={() => setIndex((index + 1) % count)}
        >
          <ChevronRight size={22} />
        </button>
      </div>
    </section>
  );
}

function HeroContent({ item }: { item: MetaPreview }) {
  const { navigate } = useRouter();
  const intent = useIntent(item);
  const { data: library } = useLibrary();
  const toggle = useToggleLibrary();
  const inLibrary = library?.some((l) => l.id === item.id);
  const open = () => navigate({ name: "detail", type: item.type, id: item.id, preview: item });

  return (
    <div className="hero-content">
      {item.logo ? (
        <Img src={item.logo} alt={item.name} className="hero-logo" loading="eager" />
      ) : (
        <h1 className="t-display hero-title">{item.name}</h1>
      )}
      <p className="hero-kind t-callout">
        {[item.type === "movie" ? "Movie" : "Series", ...(item.genres ?? []).slice(0, 2)].join(" · ")}
      </p>
      <p className="hero-description t-body">{item.description}</p>
      <div className="hero-actions">
        <button className="btn btn-primary" onClick={open} {...intent}>
          <Play size={18} fill="currentColor" /> Watch Now
        </button>
        <button
          className="btn btn-glass btn-icon"
          onClick={() => toggle.mutate(item)}
          aria-label={inLibrary ? "Remove from Library" : "Add to Library"}
          title={inLibrary ? "Remove from Library" : "Add to Library"}
          aria-pressed={inLibrary}
        >
          <SwapIcon state={library && (inLibrary ? "in" : "out")}>{inLibrary ? <Check size={20} /> : <Plus size={20} />}</SwapIcon>
        </button>
      </div>
    </div>
  );
}

// --- Shelves --------------------------------------------------------------

/** With fewer fresh titles than this, a shelf shows its full list, repeats and all. */
const MIN_FRESH = 6;

function CatalogRow({ shelf, enabled, exclude }: { shelf: Shelf; enabled: boolean; exclude: Set<string> }) {
  const { title, shape } = shelf;
  const isCatalog = shelf.kind === "catalog";
  const catalog = useCatalog(shelf.type, isCatalog ? shelf.id : "", isCatalog ? shelf.genre : undefined, enabled && isCatalog);
  const recommended = useRecommend(shelf.type, isCatalog ? "" : shelf.seed, enabled && !isCatalog);
  const { data, isLoading, isError } = isCatalog ? catalog : recommended;
  const items = useMemo(() => {
    const fresh = (data ?? []).filter((m) => !exclude.has(m.id));
    return fresh.length >= MIN_FRESH || shelf.kind === "because" ? fresh : (data ?? []);
  }, [data, exclude, shelf.kind]);

  if (isError) return null; // one failing catalog shouldn't break the page
  // Nothing good to recommend: leave the row out rather than show a stub.
  if (shelf.kind === "because" && data && items.length < 4) return null;
  const Card = shape === "landscape" ? LandscapeCard : PosterCard;
  return (
    <Row title={title} shape={shape}>
      {isLoading || !enabled
        ? Array.from({ length: 8 }, (_, i) => <CardSkeleton key={i} shape={shape} />)
        : items.map((item) => <Card key={item.id} item={item} />)}
    </Row>
  );
}

/** Holds a shelf back (as a skeleton) until it's near the viewport. */
function LazyShelf({ shelf, eager, exclude }: { shelf: Shelf; eager: boolean; exclude: Set<string> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(eager);
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    // The page scrolls inside its own container, so that's the observer's root.
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), {
      root: el.closest(".scroll"),
      rootMargin: "0px 0px 700px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return (
    <div ref={ref}>
      <CatalogRow shelf={shelf} enabled={near} exclude={exclude} />
    </div>
  );
}

function ContinueRow() {
  const { data } = useContinueWatching();
  const items = useMemo(() => data ?? [], [data]);
  if (!items.length) return null;
  return (
    <Row title="Continue Watching" shape="landscape">
      {items.map((p) => (
        <ContinueCard key={p.videoId} progress={p} />
      ))}
    </Row>
  );
}

/** The card opens the title's page; the play button resumes straight away. */
function ContinueCard({ progress: p }: { progress: Progress }) {
  const { navigate } = useRouter();
  const openDetail = () => navigate({ name: "detail", type: p.type, id: p.metaId });
  const resume = () => navigate({ name: "player", type: p.type, metaId: p.metaId, videoId: p.videoId, stream: p.stream });
  const fraction = p.duration ? p.position / p.duration : 0;
  const meta = useQuery({ queryKey: keys.meta(p.type, p.metaId), queryFn: () => api.meta(p.type, p.metaId), staleTime: 60 * 60_000 });
  const logo = meta.data?.logo;

  return (
    <div
      className="card card-landscape"
      role="link"
      tabIndex={0}
      onClick={openDetail}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          openDetail();
        }
      }}
    >
      <div className="card-frame">
        <Img src={p.background ?? p.poster} alt="" className="card-img" />
        <div className="card-art-scrim" />
        {logo ? <Img src={logo} alt={p.name} className="card-logo" /> : <span className="card-art-title t-title2">{p.name}</span>}
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
        <ProgressBar fraction={fraction} />
      </div>
      {/* Always shown: it's where you are, not a description. */}
      <div className="card-caption card-caption-keep">
        <span className="card-title t-callout">
          {p.season != null ? `${episodeCode(p.season, p.episode)} · ${p.episodeTitle ?? p.name}` : p.name}
        </span>
        <span className="t-caption faint tabular">{formatRemaining(p.position, p.duration)}</span>
      </div>
    </div>
  );
}
