import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AmbientWash } from "../components/AmbientWash";
import { Img } from "../components/Img";
import { api } from "../lib/api";
import { keys } from "../lib/queries";
import type { MetaPreview } from "../lib/types";

/**
 * The stage: the top of a TV browse screen belongs to whichever title has
 * focus — its art bleeding in from the right, its logo, facts and synopsis on
 * the left — so the rails below can stay pure artwork.
 */
export interface StageEntry {
  item: MetaPreview;
  /** A line above the facts, e.g. where you are in a show. */
  kicker?: string;
}

const StageSetter = createContext<(entry: StageEntry) => void>(() => {});
export const useStage = () => useContext(StageSetter);

/** Focus can sweep across a shelf faster than art loads; the stage follows once it settles. */
const SETTLE_MS = 160;

export function StageProvider({ children, render }: { children: ReactNode; render: (entry: StageEntry | null) => ReactNode }) {
  const [entry, setEntry] = useState<StageEntry | null>(null);
  const timer = useRef<number>(undefined);
  const first = useRef(true);
  const show = useCallback((next: StageEntry) => {
    window.clearTimeout(timer.current);
    if (first.current) {
      first.current = false;
      return setEntry(next);
    }
    timer.current = window.setTimeout(() => setEntry(next), SETTLE_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <StageSetter.Provider value={show}>
      {render(entry)}
      {children}
    </StageSetter.Provider>
  );
}

/** Type, genres, year and rating, as shown under a title. */
export function titleFacts(item: MetaPreview, extra: (string | undefined)[] = []): ReactNode[] {
  const score = Number(item.imdbRating);
  return [
    item.type === "movie" ? "Movie" : "Series",
    ...(item.genres ?? []).slice(0, 2),
    item.releaseInfo,
    ...extra,
    score > 0 ? <ImdbBadge key="imdb" value={score} /> : undefined,
  ].filter(Boolean);
}

/** The IMDb mark with the score beside it, the score tinted by band (green ≥ 7, amber ≥ 5, red below). */
function ImdbBadge({ value }: { value: number }) {
  const tone = value >= 7 ? "good" : value >= 5 ? "mid" : "low";
  return (
    <span className="imdb-badge" data-tone={tone} role="img" aria-label={`IMDb rating ${value.toFixed(1)} out of 10`}>
      <span className="imdb-badge-logo">IMDb</span>
      <span className="imdb-badge-score tabular">{value.toFixed(1)}</span>
    </span>
  );
}

export function Facts({ facts, className = "" }: { facts: ReactNode[]; className?: string }) {
  return (
    <p className={`tv-facts ${className}`}>
      {facts.map((f, i) => (
        <span key={i}>{f}</span>
      ))}
    </p>
  );
}

export function TvStage({ entry }: { entry: StageEntry | null }) {
  const item = entry?.item;
  // Continue Watching only knows the name and art; fill in the rest.
  const meta = useQuery({
    queryKey: keys.meta(item?.type ?? "movie", item?.id ?? ""),
    queryFn: () => api.meta(item!.type, item!.id),
    enabled: !!item && !item.description,
    staleTime: 60 * 60_000,
  });
  const shown = useMemo(() => {
    if (!item) return null;
    const m = !item.description ? meta.data : undefined;
    return { ...m, ...Object.fromEntries(Object.entries(item).filter(([, v]) => v != null)) } as MetaPreview;
  }, [item, meta.data]);

  return (
    <div className="tv-stage">
      <TvAmbient src={shown?.background} />
      <TvBackdrop src={shown?.background} className="tv-stage-art" />
      {shown && (
        <div key={shown.id} className="tv-stage-info" aria-live="polite">
          {shown.logo ? (
            <Img src={shown.logo} alt={shown.name} className="tv-stage-logo" loading="eager" />
          ) : (
            <h1 className="tv-stage-title">{shown.name}</h1>
          )}
          {entry?.kicker && <p className="tv-stage-kicker">{entry.kicker}</p>}
          <Facts facts={titleFacts(shown)} />
          {shown.description && <p className="tv-stage-description">{shown.description}</p>}
        </div>
      )}
    </div>
  );
}

let layerId = 0;

/**
 * Full-bleed art that cross-fades between titles: each new image fades in over
 * the last one once decoded, and the older layers go only after it's fully in,
 * so there's never a flash of black between two pictures.
 */
export function TvBackdrop({ src, className = "" }: { src?: string; className?: string }) {
  const [layers, setLayers] = useState<{ id: number; src: string; ready: boolean }[]>([]);
  useEffect(() => {
    if (!src) return;
    setLayers((ls) => (ls[ls.length - 1]?.src === src ? ls : [...ls.slice(-2), { id: ++layerId, src, ready: false }]));
  }, [src]);

  return (
    <div className={`tv-backdrop ${className}`} aria-hidden>
      {layers.map((l) => (
        <img
          key={l.id}
          src={l.src}
          alt=""
          decoding="async"
          draggable={false}
          data-ready={l.ready}
          onLoad={() => setLayers((ls) => ls.map((x) => (x.id === l.id ? { ...x, ready: true } : x)))}
          onError={() => setLayers((ls) => ls.filter((x) => x.id !== l.id))}
          onTransitionEnd={(e) => {
            if (e.propertyName !== "opacity" || !l.ready) return;
            setLayers((ls) => {
              const i = ls.findIndex((x) => x.id === l.id);
              return i > 0 ? ls.slice(i) : ls;
            });
          }}
        />
      ))}
    </div>
  );
}

/** The whole screen takes on the art's colours (the desktop hero's wash, at TV scale). */
function TvAmbient({ src }: { src?: string }) {
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    if (src) setRecent((r) => [...r.filter((s) => s !== src), src].slice(-3));
  }, [src]);
  return (
    <div className="tv-ambient" aria-hidden>
      {recent.map((s) => (
        <AmbientWash key={s} src={s} current={s === src} />
      ))}
    </div>
  );
}
