import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Info, Play, Plus, Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Img } from "../components/Img";
import { CardSkeleton, LandscapeCard, PosterCard, ProgressBar, useIntent } from "../components/PosterCard";
import { Row } from "../components/Row";
import { api } from "../lib/api";
import { episodeCode, formatRemaining } from "../lib/format";
import { keys, preloadImage, useCatalog, useContinueWatching, useLibrary, useToggleLibrary } from "../lib/queries";
import { useRouter } from "../lib/router";
import type { ContentType, MetaPreview, Progress } from "../lib/types";

const ROWS: { type: ContentType; id: string; title: string; shape: "poster" | "landscape" }[] = [
  { type: "movie", id: "trending", title: "Trending Movies", shape: "landscape" },
  { type: "series", id: "popular", title: "Popular Series", shape: "poster" },
  { type: "series", id: "trending", title: "Trending Series", shape: "landscape" },
  { type: "movie", id: "popular", title: "Popular Movies", shape: "poster" },
  { type: "movie", id: "top_rated", title: "Top Rated Movies", shape: "landscape" },
  { type: "series", id: "top_rated", title: "Top Rated Series", shape: "poster" },
];

export function Home() {
  return (
    <div className="scroll home">
      <HeroCarousel />
      <div className="rows home-rows">
        <ContinueRow />
        {ROWS.map((row) => (
          <CatalogRow key={`${row.type}/${row.id}`} {...row} />
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
 * Full-bleed featured carousel. Auto-advances, but never while you're
 * pointing at it, while the window is in the background, or when the OS asks
 * for reduced motion. The art cross-fades rather than slides: a full-screen
 * slide is a vestibular trigger and an abrupt cut is a brightness jump.
 */
function HeroCarousel() {
  const { data: items } = useFeatured();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const hero = useRef<HTMLElement>(null);
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
  }, [index, count, paused]);

  // Decode the next backdrop ahead of time so the cross-fade never waits.
  useEffect(() => {
    if (items && count) preloadImage(items[(index + 1) % count].background);
  }, [items, index, count]);

  if (!items || !item) return <section className="hero hero-placeholder skeleton" />;

  return (
    <section
      className="hero"
      ref={hero}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      aria-roledescription="carousel"
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
      <button className="hero-next btn btn-glass btn-icon pressable" aria-label="Next featured" onClick={() => setIndex((index + 1) % count)}>
        <ChevronRight size={22} />
      </button>
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
        {[item.type === "movie" ? "Movie" : "TV Show", ...(item.genres ?? []).slice(0, 2)].join(" · ")}
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
          title={inLibrary ? "In Library" : "Add to Library"}
        >
          {inLibrary ? <Check size={20} /> : <Plus size={20} />}
        </button>
        <button className="btn btn-glass btn-icon" onClick={open} aria-label="Details" title="Details">
          <Info size={20} />
        </button>
      </div>
    </div>
  );
}

// --- Shelves --------------------------------------------------------------

function CatalogRow({ type, id, title, shape }: { type: ContentType; id: string; title: string; shape: "poster" | "landscape" }) {
  const { data, isLoading, isError } = useCatalog(type, id);
  if (isError) return null; // one failing catalog shouldn't break the page
  const Card = shape === "landscape" ? LandscapeCard : PosterCard;
  return (
    <Row title={title} shape={shape}>
      {isLoading
        ? Array.from({ length: 8 }, (_, i) => <CardSkeleton key={i} shape={shape} />)
        : data?.map((item) => <Card key={item.id} item={item} />)}
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
      <div className="card-caption">
        <span className="card-title t-callout">
          {p.season != null ? `${episodeCode(p.season, p.episode)} · ${p.episodeTitle ?? p.name}` : p.name}
        </span>
        <span className="t-caption faint tabular">{formatRemaining(p.position, p.duration)}</span>
      </div>
    </button>
  );
}
