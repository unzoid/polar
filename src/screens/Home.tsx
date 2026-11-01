import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Play, Plus, Check } from "lucide-react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
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
  useToggleLibrary,
} from "../lib/queries";
import { useRouter } from "../lib/router";
import type { ContentType, MetaPreview, Progress } from "../lib/types";

/**
 * The page, top to bottom: featured carousel, what you're watching, a Top 10,
 * then shelves that alternate card shape and mix sources — trending, new,
 * genres, hidden gems, classics and "Because you watched …" — so no two
 * neighbours look or read alike. Which genres appear rotates daily, and a
 * title already shown higher up is left out of the shelves below it.
 * Shelves below the fold only fetch when scrolled near.
 */
type Shape = "poster" | "landscape";
type Shelf =
  | { kind: "catalog"; type: ContentType; id: string; genre?: string; title: string; shape: Shape }
  | { kind: "because"; type: ContentType; seed: string; title: string; shape: Shape };

const shelfKey = (s: Shelf) => (s.kind === "catalog" ? keys.catalog(s.type, s.id, s.genre) : keys.recommend(s.type, s.seed));

/** Genre shelves; a handful are picked each day. */
const GENRES: { type: ContentType; genre: string; title: string }[] = [
  { type: "movie", genre: "Action", title: "Action & Adventure" },
  { type: "movie", genre: "Sci-Fi", title: "Sci-Fi Movies" },
  { type: "movie", genre: "Animation", title: "Animated Movies" },
  { type: "movie", genre: "Comedy", title: "Comedy Movies" },
  { type: "movie", genre: "Horror", title: "Horror Movies" },
  { type: "movie", genre: "Thriller", title: "Thrillers" },
  { type: "movie", genre: "Romance", title: "Romance Movies" },
  { type: "movie", genre: "Crime", title: "Crime Movies" },
  { type: "movie", genre: "Fantasy", title: "Fantasy Movies" },
  { type: "movie", genre: "Documentary", title: "Documentaries" },
  { type: "series", genre: "Comedy", title: "Comedy Series" },
  { type: "series", genre: "Crime", title: "Crime Series" },
  { type: "series", genre: "Drama", title: "Drama Series" },
  { type: "series", genre: "Sci-Fi", title: "Sci-Fi & Fantasy Series" },
  { type: "series", genre: "Animation", title: "Animated Series" },
  { type: "series", genre: "Mystery", title: "Mystery Series" },
  { type: "series", genre: "Documentary", title: "Docuseries" },
];

/** Stable pseudo-random 0..1 for (day, key): same order all day, new one tomorrow. */
function dailyNoise(day: number, key: string) {
  let h = 2166136261 ^ day;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

interface Seed {
  type: ContentType;
  id: string;
  name: string;
}

function todaysShelves(seeds: Seed[]): Shelf[] {
  const day = Math.floor(Date.now() / 86_400_000);
  const genres = [...GENRES].sort((a, b) => dailyNoise(day, a.type + a.genre) - dailyNoise(day, b.type + b.genre));
  const genre = (i: number, shape: Shape): Shelf => ({ kind: "catalog", id: "popular", shape, ...genres[i] });
  const catalog = (type: ContentType, id: string, title: string, shape: Shape): Shelf => ({ kind: "catalog", type, id, title, shape });
  const because = (i: number, shape: Shape): Shelf[] =>
    seeds[i] ? [{ kind: "because", type: seeds[i].type, seed: seeds[i].id, title: `Because you watched ${seeds[i].name}`, shape }] : [];

  return [
    ...because(0, "landscape"),
    catalog("series", "trending", "Trending Series", "landscape"),
    catalog("movie", "new", "New Movies", "poster"),
    genre(0, "landscape"),
    catalog("series", "popular", "Popular Series", "poster"),
    ...because(1, "landscape"),
    catalog("movie", "popular", "Popular Movies", "poster"),
    genre(1, "landscape"),
    catalog("movie", "gems", "Hidden Gems", "poster"),
    genre(2, "landscape"),
    catalog("series", "new", "New Series", "poster"),
    genre(3, "landscape"),
    catalog("movie", "classics", "Classic Movies", "poster"),
    catalog("series", "top_rated", "Top Rated Series", "landscape"),
    genre(4, "poster"),
    catalog("series", "gems", "Hidden Gem Series", "landscape"),
    catalog("movie", "top_rated", "Top Rated Movies", "poster"),
    genre(5, "landscape"),
    catalog("series", "classics", "Classic Series", "poster"),
  ];
}

/** The two titles you were most recently into (watching, else saved). */
function useSeeds(): Seed[] {
  const { data: watching } = useContinueWatching();
  const { data: library } = useLibrary();
  return useMemo(() => {
    const candidates: Seed[] = [
      ...[...(watching ?? [])].sort((a, b) => b.updatedAt - a.updatedAt).map((p) => ({ type: p.type, id: p.metaId, name: p.name })),
      ...[...(library ?? [])].sort((a, b) => b.addedAt - a.addedAt).map((l) => ({ type: l.type, id: l.id, name: l.name })),
    ];
    const seen = new Set<string>();
    return candidates.filter((s) => !seen.has(s.id) && seen.add(s.id)).slice(0, 2);
  }, [watching, library]);
}

/**
 * For each shelf, the ids already shown above it (Top 10 and earlier shelves),
 * recomputed as shelves finish loading.
 */
function useShownAbove(shelves: Shelf[]) {
  const qc = useQueryClient();
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(
    () =>
      qc.getQueryCache().subscribe((e) => {
        const root = e.query.queryKey[0];
        if (e.type === "updated" && e.action.type === "success" && (root === "catalog" || root === "recommend")) bump();
      }),
    [qc],
  );
  return useMemo(() => {
    void version;
    const shown = new Set(
      top10(qc.getQueryData(keys.catalog("series", "trending")), qc.getQueryData(keys.catalog("movie", "trending"))).map(
        (m) => m.id,
      ),
    );
    return shelves.map((s) => {
      const above = new Set(shown);
      for (const m of qc.getQueryData<MetaPreview[]>(shelfKey(s)) ?? []) shown.add(m.id);
      return above;
    });
  }, [shelves, version, qc]);
}

/** The first shelves load immediately; the rest wait until they're close. */
const EAGER_SHELVES = 2;

export function Home() {
  const { data: items } = useFeatured();
  const [index, setIndex] = useState(0);
  const seeds = useSeeds();
  const shelves = useMemo(() => todaysShelves(seeds), [seeds]);
  const shownAbove = useShownAbove(shelves);
  const { data: watching } = useContinueWatching();
  const watched = useMemo(() => new Set((watching ?? []).map((p) => p.metaId)), [watching]);

  return (
    <div className="scroll home">
      <HeroCarousel items={items} index={index} setIndex={setIndex} />
      <div className="rows home-rows">
        <ContinueRow />
        <Top10Row />
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

/** Featured titles: a mix of trending series and movies that have full art. */
function useFeatured() {
  return useQuery({
    queryKey: ["featured"],
    queryFn: async () => {
      const [series, movies] = await Promise.all([api.catalog("series", "trending"), api.catalog("movie", "trending")]);
      const pick = (list: MetaPreview[]) => list.filter((m) => m.background && m.description).slice(0, 4);
      const s = pick(series);
      const m = pick(movies);
      // Interleave so the carousel alternates TV and film.
      return s.flatMap((item, i) => (m[i] ? [item, m[i]] : [item])).slice(0, 7);
    },
  });
}

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

  useEffect(() => {
    if (!count || paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => {
      // Don't rotate while hidden under another page or behind other windows.
      if (document.hasFocus() && hero.current?.checkVisibility({ visibilityProperty: true })) {
        setIndex((i) => (i + 1) % count);
      }
    }, ADVANCE_MS);
    return () => window.clearInterval(t);
  }, [index, count, paused, setIndex]);

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

/**
 * The art shrunk to a few pixels: stretched back up, the browser's smoothing
 * turns it into one soft gradient of the image's main colours — no busy detail
 * showing through, and no per-frame blur cost. Drawing a cross-origin image is
 * fine; only reading its pixels back would be blocked.
 */
function AmbientWash({ src, current }: { src?: string; current: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      const ctx = canvas.current?.getContext("2d");
      if (!ctx) return;
      // Two steps so the tiny version averages the whole picture, not a few pixels of it.
      const mid = document.createElement("canvas");
      mid.width = 48;
      mid.height = 27;
      const m = mid.getContext("2d");
      if (!m) return;
      m.imageSmoothingQuality = "high";
      m.drawImage(img, 0, 0, mid.width, mid.height);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(mid, 0, 0, ctx.canvas.width, ctx.canvas.height);
      setReady(true);
    };
    img.src = src;
    return () => {
      img.onload = null;
    };
  }, [src]);

  return <canvas ref={canvas} width={4} height={3} data-current={current && ready} />;
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
          aria-label={inLibrary ? "Remove from My List" : "Add to My List"}
          title={inLibrary ? "Remove from My List" : "Add to My List"}
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

/** The ten most popular titles, series and movies alternating. */
function top10(series?: MetaPreview[], movies?: MetaPreview[]) {
  const s = (series ?? []).filter((m) => m.poster);
  const m = (movies ?? []).filter((x) => x.poster);
  const out: MetaPreview[] = [];
  for (let i = 0; out.length < 10 && (i < s.length || i < m.length); i++) {
    if (s[i]) out.push(s[i]);
    if (m[i] && out.length < 10) out.push(m[i]);
  }
  return out;
}

/** Today's ten most popular titles, movies and series mixed, with big rank numbers. */
function Top10Row() {
  const series = useCatalog("series", "trending");
  const movies = useCatalog("movie", "trending");
  const top = useMemo(() => top10(series.data, movies.data), [series.data, movies.data]);

  if (!top.length) return null;
  return (
    <Row title="Top 10 Today" shape="top10">
      {top.map((item, i) => (
        <div className="top10-item" key={item.id}>
          <span className="top10-rank" aria-hidden>
            {i + 1}
          </span>
          <PosterCard item={item} />
        </div>
      ))}
    </Row>
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

/** One click resumes playback — no detour through the detail page. */
function ContinueCard({ progress: p }: { progress: Progress }) {
  const { navigate } = useRouter();
  const fraction = p.duration ? p.position / p.duration : 0;
  const meta = useQuery({ queryKey: keys.meta(p.type, p.metaId), queryFn: () => api.meta(p.type, p.metaId), staleTime: 60 * 60_000 });
  const logo = meta.data?.logo;

  return (
    <button
      className="card card-landscape"
      onClick={() => navigate({ name: "player", type: p.type, metaId: p.metaId, videoId: p.videoId, stream: p.stream })}
    >
      <div className="card-frame">
        <Img src={p.background ?? p.poster} alt="" className="card-img" />
        <div className="card-art-scrim" />
        {logo ? <Img src={logo} alt={p.name} className="card-logo" /> : <span className="card-art-title t-title2">{p.name}</span>}
        <span className="card-play" aria-hidden>
          <Play size={20} fill="currentColor" />
        </span>
        <ProgressBar fraction={fraction} />
      </div>
      {/* Always shown: it's where you are, not a description. */}
      <div className="card-caption card-caption-keep">
        <span className="card-title t-callout">
          {p.season != null ? `${episodeCode(p.season, p.episode)} · ${p.episodeTitle ?? p.name}` : p.name}
        </span>
        <span className="t-caption faint tabular">{formatRemaining(p.position, p.duration)}</span>
      </div>
    </button>
  );
}
